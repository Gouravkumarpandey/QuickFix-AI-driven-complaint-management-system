import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Complaint } from "../models/Complaint.js";
import { findUserById } from "../models/User.js";
import { Ticket, Message, Membership } from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  audit,
} from "./access.js";
import { createTicket } from "./tickets.js";
import { validate, fail } from "./validation.js";
const selection = Joi.object({
  ids: Joi.array()
    .items(Joi.string().hex().length(24))
    .unique()
    .min(1)
    .max(100)
    .required(),
});
export async function migrationPreview(req, ids) {
  const filter = {
    _id: { $in: ids.map(objectId) },
    ...(req.user.role === "admin" ? {} : { user: req.user._id }),
  };
  const complaints = await Complaint.find(filter).lean();
  if (complaints.length !== ids.length)
    throw fail(
      "Some selected complaints are missing or you do not own them",
      403,
    );
  const migrated = await Ticket.find({
    workspace: req.workspace._id,
    legacyId: { $in: ids },
  })
    .select("legacyId")
    .lean();
  return complaints.map((row) => ({
    id: row._id,
    title: row.title,
    status: row.status,
    alreadyImported: migrated.some(
      (t) => String(t.legacyId) === String(row._id),
    ),
    attachmentsRequiringRescan: row.attachments?.length || 0,
    hasAssignedAgent: !!row.assignedTo,
  }));
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/migration/candidates",
  permit("owner"),
  wrap(async (req, res) => {
    const rows = await Complaint.find(
      req.user.role === "admin" ? {} : { user: req.user._id },
    )
      .select("title complaintId status createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(rows);
  }),
);
router.post(
  "/:workspaceId/migration/preview",
  permit("owner"),
  wrap(async (req, res) => {
    const { ids } = validate(selection, req.body);
    res.json(await migrationPreview(req, ids));
  }),
);
router.post(
  "/:workspaceId/migration/import",
  permit("owner"),
  wrap(async (req, res) => {
    const { ids, confirmed } = validate(
      selection.keys({ confirmed: Joi.boolean().valid(true).required() }),
      req.body,
    );
    await migrationPreview(req, ids);
    const results = [];
    for (const id of ids) {
      const result = await withActor(req, async (session, workspace) => {
        const existing = await Ticket.findOne({
          workspace: workspace._id,
          legacyId: objectId(id),
        }).session(session);
        if (existing) return { id, number: existing.number, duplicate: true };
        const row = await Complaint.findOne({
          _id: objectId(id),
          ...(req.user.role === "admin" ? {} : { user: req.user._id }),
        })
          .session(session)
          .lean();
        if (!row) throw fail("Complaint unavailable", 404);
        const { user } = await findUserById(row.user);
        if (!user?.email)
          throw fail(
            "Legacy customer is unavailable; map the record manually",
            409,
          );
        const data = await createTicket(
          {
            ...workspace.toObject(),
            settings: { ...workspace.settings, customFields: [] },
          },
          {
            subject: row.title,
            description: row.description,
            email: user.email,
            name: user.name,
            priority: row.priority,
          },
          req.user._id,
          session,
          { legacyDate: row.createdAt, migration: true },
        );
        const ticket = data.ticket;
        ticket.legacyId = row._id;
        ticket.status = ["Resolved", "Closed"].includes(row.status)
          ? row.status
          : "Open";
        if (["Resolved", "Closed"].includes(row.status))
          ticket.sla.resolvedAt = row.resolvedAt || row.updatedAt;
        if (row.assignedTo) {
          const { user: agent } = await findUserById(row.assignedTo);
          const member =
            agent &&
            (await Membership.findOne({
              workspace: workspace._id,
              email: agent.email,
              active: true,
              entitlementSuspended: { $ne: true },
              role: { $in: ["owner", "admin", "agent"] },
            }).session(session));
          if (member) ticket.assignedTo = member._id;
        }
        for (const update of (row.updates || []).slice(0, 500)) {
          if (update.isInternal && req.user.role !== "admin") continue;
          if (update.message)
            await Message.create(
              [
                {
                  workspace: workspace._id,
                  ticket: ticket._id,
                  author: "legacy import",
                  authorRole: update.isInternal ? "agent" : "legacy",
                  text: String(update.message).slice(0, 10000),
                  internal: !!update.isInternal,
                  createdAt: update.timestamp || row.createdAt,
                },
              ],
              { session },
            );
        }
        await ticket.save({ session, timestamps: false });
        await audit(
          workspace._id,
          req.user._id,
          "migration.import",
          ticket._id,
          session,
          {
            legacyId: id,
            attachmentsPendingRescan: row.attachments?.length || 0,
          },
        );
        return { id, number: ticket.number, duplicate: false };
      });
      results.push(result);
    }
    res.json({
      results,
      notice:
        "Old records are unchanged. Legacy files require a fresh scanned upload. Existing subscription and identity credentials are not copied.",
    });
  }),
);
export default router;

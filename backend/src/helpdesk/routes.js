import { encrypt } from "./connectors.js";
import rateLimit from "express-rate-limit";
import express from "express";
import Joi from "joi";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  Workspace,
  Membership,
  Invitation,
  Ticket,
  Message,
  Contact,
  Article,
  Resource,
  Audit,
  Presence,
  Job,
} from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  inWorkspace,
  withActor,
  ticketAccess,
  audit,
  assertSeat,
  canManage,
  canWork,
} from "./access.js";
import {
  validate,
  fail,
  oid,
  text,
  priority,
  filters,
  actions,
  resourceSchemas,
  settingsSchema,
} from "./validation.js";
import {
  digest,
  createTicket,
  addMessage,
  updateTicket,
  applyActions,
  enqueue,
} from "./tickets.js";
import { toCSV } from "../utils/csv.js";
const router = express.Router();
router.use(authenticate);
router.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
const nameSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  slug: Joi.string()
    .lowercase()
    .pattern(/^[a-z0-9][a-z0-9-]{2,49}$/)
    .required(),
});
router.get(
  "/",
  wrap(async (req, res) => {
    const memberships = await Membership.find({
      user: req.user._id,
      active: true,
    }).lean();
    const workspaces = await Workspace.find({
      _id: { $in: memberships.map((member) => member.workspace) },
    }).lean();
    res.json({
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        role: memberships.find(
          (member) => String(member.workspace) === String(workspace._id),
        ).role,
      })),
    });
  }),
);
router.post(
  "/",
  wrap(async (req, res) => {
    const input = validate(nameSchema, req.body),
      session = await mongoose.startSession();
    let workspace;
    try {
      await session.withTransaction(async () => {
        [workspace] = await Workspace.create([input], { session });
        await Membership.create(
          [
            {
              workspace: workspace._id,
              user: req.user._id,
              email: req.user.email.toLowerCase(),
              name: req.user.name,
              role: "owner",
            },
          ],
          { session },
        );
        await audit(
          workspace._id,
          req.user._id,
          "workspace.created",
          workspace._id,
          session,
        );
      });
      res.status(201).json(workspace);
    } finally {
      await session.endSession();
    }
  }),
);
router.post(
  "/invites/accept",
  wrap(async (req, res) => {
    const { token } = validate(
      Joi.object({ token: Joi.string().hex().length(64).required() }),
      req.body,
    );
    const invite = await Invitation.findOne({
      tokenHash: digest(token),
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
      email: req.user.email.toLowerCase(),
    });
    if (!invite)
      throw fail(
        "Invitation is invalid, expired or belongs to another email",
        404,
      );
    const member = await inWorkspace(
      invite.workspace,
      async (session, workspace) => {
        const current = await Invitation.findOne({
          _id: invite._id,
          acceptedAt: null,
          expiresAt: { $gt: new Date() },
        }).session(session);
        if (!current) throw fail("Invitation already used", 409);
        let member = await Membership.findOne({
          workspace: workspace._id,
          user: req.user._id,
        }).session(session);
        if (member?.active) throw fail("Already a workspace member", 409);
        if (invite.role !== "customer") await assertSeat(workspace, session);
        if (member) {
          member.role = invite.role;
          member.active = true;
          await member.save({ session });
        } else
          [member] = await Membership.create(
            [
              {
                workspace: workspace._id,
                user: req.user._id,
                name: req.user.name,
                email: req.user.email.toLowerCase(),
                role: invite.role,
              },
            ],
            { session },
          );
        current.acceptedAt = new Date();
        await current.save({ session });
        await audit(
          workspace._id,
          req.user._id,
          "member.joined",
          member._id,
          session,
        );
        return member;
      },
    );
    res.json(member);
  }),
);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId",
  wrap(async (req, res) =>
    res.json({ workspace: req.workspace, member: req.member }),
  ),
);
router.patch(
  "/:workspaceId",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        name: Joi.string().trim().min(2).max(100),
        settings: settingsSchema,
      }).min(1),
      req.body,
    );
    const workspace = await withActor(req, async (session, workspace) => {
      if (input.name) workspace.name = input.name;
      if (input.settings) {
        const next = { ...workspace.settings, ...input.settings };
        if (
          next.pauseStatuses.some((status) => !next.statuses.includes(status))
        )
          throw fail("Paused statuses must exist in the ticket statuses");
        workspace.settings = next;
      }
      await workspace.save({ session });
      await audit(
        workspace._id,
        req.user._id,
        "workspace.updated",
        workspace._id,
        session,
      );
      return workspace;
    });
    res.json(workspace);
  }),
);
router.get(
  "/:workspaceId/members",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json(
      await Membership.find({ workspace: req.workspace._id })
        .select("-user")
        .lean(),
    ),
  ),
);
router.post(
  "/:workspaceId/invites",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        email: Joi.string().email().lowercase().required(),
        role: Joi.string()
          .valid("admin", "agent", "analyst", "customer")
          .required(),
      }),
      req.body,
    );
    if (req.member.role !== "owner" && input.role === "admin")
      throw fail("Only the owner can invite administrators", 403);
    const token = crypto.randomBytes(32).toString("hex");
    await Invitation.create({
      ...input,
      workspace: req.workspace._id,
      invitedBy: req.user._id,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
    res.status(201).json({
      token,
      url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/workspaces?invite=${token}`,
      expiresInDays: 7,
    });
  }),
);
router.patch(
  "/:workspaceId/members/:memberId",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        role: Joi.string().valid(
          "owner",
          "admin",
          "agent",
          "analyst",
          "customer",
        ),
        active: Joi.boolean(),
        capacity: Joi.number().integer().min(1).max(100),
        online: Joi.boolean(),
        groups: Joi.array().max(20).items(Joi.string().max(80)),
        skills: Joi.array().max(20).items(Joi.string().max(80)),
      }).min(1),
      req.body,
    );
    const member = await withActor(req, async (session, workspace) => {
      const member = await Membership.findOne({
        _id: objectId(req.params.memberId),
        workspace: workspace._id,
      }).session(session);
      if (!member) throw fail("Member not found", 404);
      if (
        (["owner", "admin"].includes(member.role) ||
          ["owner", "admin"].includes(input.role)) &&
        req.member.role !== "owner"
      )
        throw fail("Owner permission required", 403);
      if (
        member.role === "owner" &&
        member.active &&
        (input.active === false || (input.role && input.role !== "owner")) &&
        (await Membership.countDocuments({
          workspace: workspace._id,
          role: "owner",
          active: true,
        }).session(session)) <= 1
      )
        throw fail("Cannot remove the last owner", 409);
      const wasStaff = member.active && member.role !== "customer",
        willStaff =
          (input.active ?? member.active) &&
          (input.role ?? member.role) !== "customer";
      if (!wasStaff && willStaff) await assertSeat(workspace, session);
      Object.assign(member, input);
      await member.save({ session });
      if (!member.active || !["owner", "admin", "agent"].includes(member.role))
        await Ticket.updateMany(
          {
            workspace: workspace._id,
            assignedTo: member._id,
            status: { $nin: ["Resolved", "Closed"] },
          },
          { $set: { assignedTo: null } },
          { session },
        );
      await audit(
        workspace._id,
        req.user._id,
        "member.updated",
        member._id,
        session,
        input,
      );
      return member;
    });
    res.json(member);
  }),
);
const ticketSchema = Joi.object({
  subject: Joi.string().trim().min(3).max(200).required(),
  description: text.min(3).required(),
  email: Joi.string().email().lowercase(),
  name: Joi.string().max(100),
  phone: Joi.string().max(30),
  priority,
  group: Joi.string().max(80),
  tags: Joi.array().max(20).items(Joi.string().max(60)),
  customFields: Joi.object(),
  channel: Joi.string().valid("web", "chat"),
});
router.get(
  "/:workspaceId/tickets",
  permit("owner", "admin", "agent", "customer"),
  wrap(async (req, res) => {
    const input = validate(
      filters.append({
        bucket: Joi.string().valid(
          "open",
          "unassigned",
          "overdue",
          "due-today",
          "resolved",
        ),
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(30),
        view: oid,
      }),
      req.query,
    );
    let selected = { ...input };
    if (input.view) {
      const view = await Resource.findOne({
        _id: input.view,
        workspace: req.workspace._id,
        kind: "view",
      });
      if (!view) throw fail("View not found", 404);
      selected = { ...validate(filters, view.value), ...selected };
    }
    const query = { workspace: req.workspace._id, mergedInto: null };
    for (const key of ["status", "priority", "channel", "group"])
      if (selected[key]) query[key] = selected[key];
    if (selected.assignedTo) query.assignedTo = selected.assignedTo;
    if (selected.mine) query.assignedTo = req.member._id;
    if (selected.bucket === "open")
      query.status = { $nin: ["Resolved", "Closed"] };
    if (selected.bucket === "resolved")
      query.status = { $in: ["Resolved", "Closed"] };
    if (selected.bucket === "unassigned") {
      query.assignedTo = null;
      query.status = { $nin: ["Resolved", "Closed"] };
    }
    if (selected.bucket === "due-today") {
      query.status = { $nin: ["Resolved", "Closed"] };
      query["sla.resolutionDue"] = {
        $gte: new Date(),
        $lt: new Date(Date.now() + 86400000),
      };
    }
    if (selected.bucket === "overdue") {
      query.status = { $nin: ["Resolved", "Closed"] };
      query["sla.pausedAt"] = null;
      query.$and = [
        {
          $or: [
            {
              "sla.firstDue": { $lt: new Date() },
              "sla.firstRespondedAt": null,
            },
            { "sla.nextDue": { $lt: new Date() } },
            { "sla.resolutionDue": { $lt: new Date() } },
          ],
        },
      ];
    }

    if (selected.search)
      query.$or = ["subject", "number"].map((field) => ({
        [field]: {
          $regex: selected.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }));
    if (req.member.role === "customer") {
      const contact = await Contact.findOne({
        workspace: req.workspace._id,
        email: req.user.email.toLowerCase(),
      });
      query.contact = contact?._id || null;
    }
    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .sort({ updatedAt: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .populate("contact", "name email company")
        .populate("assignedTo", "name role")
        .lean(),
      Ticket.countDocuments(query),
    ]);
    res.json({ tickets, total, page: input.page });
  }),
);
router.post(
  "/:workspaceId/tickets",
  permit("owner", "admin", "agent", "customer"),
  wrap(async (req, res) => {
    const input = validate(ticketSchema, req.body);
    if (req.member.role === "customer" || !input.email)
      input.email = req.user.email.toLowerCase();
    const result = await withActor(req, (session, workspace) =>
      createTicket(workspace, input, req.user._id, session),
    );
    res.status(201).json(result.ticket);
  }),
);
router.get(
  "/:workspaceId/tickets/:ticketId",
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    const query = { workspace: req.workspace._id, ticket: ticket._id };
    if (req.member.role === "customer") query.internal = false;
    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    res.json({ ticket, messages });
  }),
);
router.post(
  "/:workspaceId/tickets/:ticketId/verify-customer",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    await withActor(req, async (session, workspace) => {
      const ticket = await ticketAccess(req, req.params.ticketId, session);
      if (!ticket.guest || ticket.guestVerified)
        throw fail("Customer verification is not required", 409);
      if (
        ticket.emailVerifySentAt &&
        Date.now() - ticket.emailVerifySentAt.getTime() < 300000
      )
        throw fail(
          "Please wait five minutes before sending another verification email",
          429,
        );
      const proof = crypto.randomBytes(32).toString("hex"),
        sealed = encrypt(proof);
      ticket.emailVerifyHash = digest(proof);
      ticket.emailVerifyExpires = new Date(Date.now() + 1800000);
      ticket.emailVerifySentAt = new Date();
      await ticket.save({ session });
      await enqueue(
        workspace._id,
        "verify.email",
        { ticket: ticket._id, proof: sealed },
        `verify:${ticket._id}:${digest(proof)}`,
        session,
      );
    });
    res.json({ queued: true });
  }),
);
router.post(
  "/:workspaceId/tickets/:ticketId/presence",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    await Presence.findOneAndUpdate(
      {
        workspace: req.workspace._id,
        ticket: ticket._id,
        member: req.member._id,
      },
      { $set: { expiresAt: new Date(Date.now() + 30000) } },
      { upsert: true },
    );
    const viewers = await Presence.find({
      workspace: req.workspace._id,
      ticket: ticket._id,
      member: { $ne: req.member._id },
      expiresAt: { $gt: new Date() },
    })
      .populate("member", "name email")
      .lean();
    res.json(
      viewers.map((item) => ({ name: item.member.name || item.member.email })),
    );
  }),
);
router.patch(
  "/:workspaceId/tickets/:ticketId",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(
      actions.append({
        expectedVersion: Joi.number().integer().min(0),
        customFields: Joi.object(),
      }),
      req.body,
    );
    res.json(
      await withActor(req, (session, workspace) =>
        updateTicket(req, req.params.ticketId, input, session, workspace),
      ),
    );
  }),
);
router.post(
  "/:workspaceId/tickets/:ticketId/messages",
  permit("owner", "admin", "agent", "customer"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        text: text.min(1).required(),
        internal: Joi.boolean().default(false),
      }),
      req.body,
    );
    const message = await withActor(req, async (session, workspace) => {
      const ticket = await ticketAccess(req, req.params.ticketId, session);
      return addMessage(
        workspace,
        ticket,
        input,
        req.user._id,
        req.member.role === "customer" ? "customer" : "agent",
        session,
      );
    });
    res.status(201).json(message);
  }),
);
router.post(
  "/:workspaceId/tickets/:ticketId/merge",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const { target } = validate(
      Joi.object({ target: oid.required() }),
      req.body,
    );
    if (target === req.params.ticketId)
      throw fail("Cannot merge a ticket into itself");
    const result = await withActor(req, async (session, workspace) => {
      const source = await ticketAccess(req, req.params.ticketId, session),
        destination = await ticketAccess(req, target, session);
      if (
        (source.guest && !source.guestVerified) ||
        (destination.guest && !destination.guestVerified)
      )
        throw fail(
          "Guest conversations cannot be merged before customer identity is verified",
          409,
        );
      if (source.mergedInto || destination.mergedInto)
        throw fail("Ticket already merged", 409);
      if (String(source.contact) !== String(destination.contact))
        throw fail("Only tickets from the same customer can be merged");
      await Message.updateMany(
        { workspace: workspace._id, ticket: source._id },
        { $set: { ticket: destination._id } },
        { session },
      );
      source.mergedInto = destination._id;
      source.status = "Closed";
      await source.save({ session });
      destination.version++;
      await destination.save({ session });
      await audit(
        workspace._id,
        req.user._id,
        "ticket.merged",
        source._id,
        session,
        { target },
      );
      return destination;
    });
    res.json(result);
  }),
);
router.get(
  "/:workspaceId/contacts",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) =>
    res.json(
      await Contact.find({ workspace: req.workspace._id })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean(),
    ),
  ),
);
router.patch(
  "/:workspaceId/contacts/:contactId",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        name: Joi.string().max(100),
        phone: Joi.string().max(30),
        company: Joi.string().max(100),
        notes: text,
        tags: Joi.array().max(20).items(Joi.string().max(60)),
      }).min(1),
      req.body,
    );
    const contact = await Contact.findOneAndUpdate(
      { _id: objectId(req.params.contactId), workspace: req.workspace._id },
      { $set: input },
      { new: true, runValidators: true },
    );
    if (!contact) throw fail("Contact not found", 404);
    res.json(contact);
  }),
);
router.get(
  "/:workspaceId/resources/:kind",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) => {
    if (!Object.hasOwn(resourceSchemas, req.params.kind))
      throw fail("Unknown resource");
    res.json(
      await Resource.find({
        workspace: req.workspace._id,
        kind: req.params.kind,
      }).lean(),
    );
  }),
);
router.post(
  "/:workspaceId/resources/:kind",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const kind = req.params.kind;
    if (!Object.hasOwn(resourceSchemas, kind)) throw fail("Unknown resource");
    if (["automation", "sla"].includes(kind) && !canManage(req.member))
      throw fail("Administrator permission required", 403);
    const input = validate(
      Joi.object({
        name: Joi.string().min(2).max(100).required(),
        value: resourceSchemas[kind].required(),
      }),
      req.body,
    );
    res.status(201).json(
      await Resource.create({
        ...input,
        workspace: req.workspace._id,
        kind,
        author: req.user._id,
      }),
    );
  }),
);
router.delete(
  "/:workspaceId/resources/:resourceId",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const item = await Resource.findOne({
      _id: objectId(req.params.resourceId),
      workspace: req.workspace._id,
    });
    if (!item) throw fail("Resource not found", 404);
    if (["automation", "sla"].includes(item.kind) && !canManage(req.member))
      throw fail("Administrator permission required", 403);
    await item.deleteOne();
    res.json({ deleted: true });
  }),
);
router.post(
  "/:workspaceId/tickets/:ticketId/macros/:macroId",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const ticket = await withActor(req, async (session, workspace) => {
      const ticket = await ticketAccess(req, req.params.ticketId, session),
        macro = await Resource.findOne({
          _id: objectId(req.params.macroId),
          workspace: workspace._id,
          kind: "macro",
        }).session(session);
      if (!macro) throw fail("Macro not found", 404);
      await applyActions(
        workspace,
        ticket,
        macro.value.actions,
        req.user._id,
        session,
      );
      ticket.version++;
      await ticket.save({ session });
      await audit(
        workspace._id,
        req.user._id,
        "macro.applied",
        ticket._id,
        session,
      );
      return ticket;
    });
    res.json(ticket);
  }),
);
router.get(
  "/:workspaceId/articles",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json(
      await Article.find({ workspace: req.workspace._id })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean(),
    ),
  ),
);
const articleSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-z0-9-]{2,100}$/)
    .required(),
  title: Joi.string().min(3).max(200).required(),
  body: text.min(10).required(),
  category: Joi.string().max(100).default("General"),
  language: Joi.string().max(20).default("en"),
  published: Joi.boolean().default(false),
});
router.post(
  "/:workspaceId/articles",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(articleSchema, req.body);
    if (input.published && !canManage(req.member))
      throw fail("Administrator permission required to publish", 403);
    res.status(201).json(
      await Article.create({
        ...input,
        workspace: req.workspace._id,
        author: req.user._id,
      }),
    );
  }),
);
router.patch(
  "/:workspaceId/articles/:articleId",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(articleSchema, req.body);
    if (input.published && !canManage(req.member))
      throw fail("Administrator permission required to publish", 403);
    const article = await Article.findOneAndUpdate(
      { _id: objectId(req.params.articleId), workspace: req.workspace._id },
      { $set: input },
      { new: true, runValidators: true },
    );
    if (!article) throw fail("Article not found", 404);
    res.json(article);
  }),
);
router.get(
  "/:workspaceId/reports",
  permit("owner", "admin", "analyst"),
  wrap(async (req, res) => {
    const tickets = await Ticket.aggregate([
      { $match: { workspace: req.workspace._id, mergedInto: null } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const [total, breached, contacts] = await Promise.all([
      Ticket.countDocuments({ workspace: req.workspace._id }),
      Ticket.countDocuments({
        workspace: req.workspace._id,
        "sla.breached": true,
      }),
      Contact.countDocuments({ workspace: req.workspace._id }),
    ]);
    if (req.query.format === "csv") {
      res
        .type("text/csv")
        .attachment("ticket-report.csv")
        .send(
          toCSV(
            tickets.map((row) => ({ status: row._id, count: row.count })),
            ["status", "count"],
          ),
        );
      return;
    }
    res.json({ total, breached, contacts, byStatus: tickets });
  }),
);
router.get(
  "/:workspaceId/jobs",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json(
      await Job.find({ workspace: req.workspace._id })
        .select("kind state attempts lastError createdAt updatedAt")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ),
  ),
);
router.post(
  "/:workspaceId/jobs/:jobId/retry",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const result = await Job.updateOne(
      {
        _id: objectId(req.params.jobId),
        workspace: req.workspace._id,
        state: "failed",
      },
      {
        $set: { state: "queued", attempts: 0, availableAt: new Date() },
        $unset: { lockedUntil: 1, lastError: 1 },
      },
    );
    if (!result.matchedCount) throw fail("Failed job not found", 404);
    res.json({ queued: true });
  }),
);
router.get(
  "/:workspaceId/audit",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json(
      await Audit.find({ workspace: req.workspace._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ),
  ),
);
export default router;

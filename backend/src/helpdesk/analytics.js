import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Ticket, Message, Membership, Audit, Dashboard } from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  audit,
} from "./access.js";
import { entitlement, requireFeature } from "./entitlements.js";
import { validate, fail } from "./validation.js";
export const widgetNames = [
  "summary",
  "trend",
  "channels",
  "priorities",
  "agents",
  "activity",
];
export async function operations(
  workspace,
  member,
  { days = 30, group = "", mine = false } = {},
) {
  const now = new Date(),
    since = new Date(now.getTime() - days * 86400000),
    base = {
      workspace: workspace._id,
      mergedInto: null,
      ...(group ? { group } : {}),
      ...(mine || member.role === "agent" ? { assignedTo: member._id } : {}),
    };
  const [summary, trend, channels, priorities, agents, activity] =
    await Promise.all([
      Ticket.aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            open: {
              $sum: {
                $cond: [
                  { $not: [{ $in: ["$status", ["Resolved", "Closed"]] }] },
                  1,
                  0,
                ],
              },
            },
            unassigned: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $ifNull: ["$assignedTo", false] }] },
                      { $not: [{ $in: ["$status", ["Resolved", "Closed"]] }] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            overdue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: ["$status", ["Resolved", "Closed"]] }] },
                      { $not: [{ $ifNull: ["$sla.pausedAt", false] }] },
                      {
                        $or: [
                          {
                            $and: [
                              {
                                $and: [
                                  {
                                    $ne: [
                                      { $ifNull: ["$sla.firstDue", null] },
                                      null,
                                    ],
                                  },
                                  { $lt: ["$sla.firstDue", now] },
                                ],
                              },
                              {
                                $not: [
                                  { $ifNull: ["$sla.firstRespondedAt", false] },
                                ],
                              },
                            ],
                          },
                          {
                            $and: [
                              {
                                $ne: [
                                  { $ifNull: ["$sla.nextDue", null] },
                                  null,
                                ],
                              },
                              { $lt: ["$sla.nextDue", now] },
                            ],
                          },
                          {
                            $and: [
                              {
                                $ne: [
                                  { $ifNull: ["$sla.resolutionDue", null] },
                                  null,
                                ],
                              },
                              { $lt: ["$sla.resolutionDue", now] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            dueToday: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $ifNull: ["$sla.pausedAt", false] }] },
                      { $gte: ["$sla.resolutionDue", now] },
                      {
                        $lt: [
                          "$sla.resolutionDue",
                          new Date(now.getTime() + 86400000),
                        ],
                      },
                      { $not: [{ $in: ["$status", ["Resolved", "Closed"]] }] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            resolved: {
              $sum: {
                $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0],
              },
            },
            firstResponseMinutes: {
              $avg: {
                $cond: [
                  { $ifNull: ["$sla.firstRespondedAt", false] },
                  {
                    $divide: [
                      { $subtract: ["$sla.firstRespondedAt", "$createdAt"] },
                      60000,
                    ],
                  },
                  null,
                ],
              },
            },
            resolutionMinutes: {
              $avg: {
                $cond: [
                  { $ifNull: ["$sla.resolvedAt", false] },
                  {
                    $divide: [
                      { $subtract: ["$sla.resolvedAt", "$createdAt"] },
                      60000,
                    ],
                  },
                  null,
                ],
              },
            },
          },
        },
      ]),
      Ticket.aggregate([
        { $match: { ...base, createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              $dateToString: {
                date: "$createdAt",
                format: "%Y-%m-%d",
                timezone: workspace.settings.timezone || "Asia/Kolkata",
              },
            },
            created: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Ticket.aggregate([
        { $match: { ...base, createdAt: { $gte: since } } },
        { $group: { _id: "$channel", count: { $sum: 1 } } },
      ]),
      Ticket.aggregate([
        { $match: { ...base, status: { $nin: ["Resolved", "Closed"] } } },
        { $group: { _id: "$priority", count: { $sum: 1 } } },
      ]),
      Membership.find({
        workspace: workspace._id,
        active: true,
        role: { $in: ["owner", "admin", "agent"] },
        ...(member.role === "agent" ? { _id: member._id } : {}),
      })
        .select("name email online capacity entitlementSuspended")
        .lean(),
      member.role === "agent"
        ? Promise.resolve([])
        : Audit.find({ workspace: workspace._id })
            .sort({ createdAt: -1 })
            .limit(8)
            .lean(),
    ]);
  const distribution = await Ticket.aggregate([
    { $match: base },
    {
      $group: {
        _id: "$assignedTo",
        open: {
          $sum: { $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 0, 1] },
        },
        resolved: {
          $sum: { $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0] },
        },
        responseMinutes: {
          $avg: {
            $cond: [
              { $ifNull: ["$sla.firstRespondedAt", false] },
              {
                $divide: [
                  { $subtract: ["$sla.firstRespondedAt", "$createdAt"] },
                  60000,
                ],
              },
              null,
            ],
          },
        },
      },
    },
  ]);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: workspace.settings.timezone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKey = (date) => {
    const p = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  const dates = new Set(
    Array.from({ length: days + 1 }, (_, i) =>
      dayKey(new Date(since.getTime() + i * 86400000)),
    ),
  );
  dates.add(dayKey(now));
  const series = [...dates].sort().map((date) => ({
    _id: date,
    created: trend.find((row) => row._id === date)?.created || 0,
  }));
  return {
    summary: summary[0] || {
      total: 0,
      open: 0,
      unassigned: 0,
      overdue: 0,
      dueToday: 0,
      resolved: 0,
    },
    trend: series,
    channels,
    priorities,
    agents: agents.map((agent) => ({
      ...agent,
      ...distribution.find((row) => String(row._id) === String(agent._id)),
      _id: agent._id,
    })),
    activity,
    range: { days, since, timezone: workspace.settings.timezone },
    entitlement: entitlement(workspace),
  };
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/operations",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        days: Joi.number().integer().min(1).max(90).default(30),
        group: Joi.string().max(80).allow(""),
        mine: Joi.boolean().default(false),
      }),
      req.query,
    );
    res.json(await operations(req.workspace, req.member, input));
  }),
);
router.get(
  "/:workspaceId/dashboards",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json(
      await Dashboard.find({
        workspace: req.workspace._id,
        member: req.member._id,
      }).lean(),
    ),
  ),
);
router.post(
  "/:workspaceId/dashboards",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "analytics");
    const input = validate(
      Joi.object({
        name: Joi.string().trim().min(2).max(80).required(),
        widgets: Joi.array()
          .items(Joi.string().valid(...widgetNames))
          .unique()
          .min(1)
          .max(6)
          .required(),
        days: Joi.number().integer().min(1).max(90).default(30),
      }),
      req.body,
    );
    const row = await withActor(req, async (session) => {
      if (
        (await Dashboard.countDocuments({
          workspace: req.workspace._id,
          member: req.member._id,
        }).session(session)) >= 10
      )
        throw fail("Dashboard limit reached", 409);
      return (
        await Dashboard.create(
          [{ ...input, workspace: req.workspace._id, member: req.member._id }],
          { session },
        )
      )[0];
    });
    res.status(201).json(row);
  }),
);
router.delete(
  "/:workspaceId/dashboards/:id",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) => {
    const result = await Dashboard.deleteOne({
      _id: objectId(req.params.id),
      workspace: req.workspace._id,
      member: req.member._id,
    });
    if (!result.deletedCount) throw fail("Dashboard not found", 404);
    res.json({ deleted: true });
  }),
);
export default router;

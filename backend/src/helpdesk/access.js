import mongoose from "mongoose";
import { CustomRole } from "./models.js";
import { seatAllowed, requireFeature } from "./entitlements.js";
import { Membership, Workspace, Ticket, Audit } from "./models.js";
import { fail } from "./validation.js";
export const staffRoles = ["owner", "admin", "agent", "analyst"];
export const canManage = (member) => ["owner", "admin"].includes(member.role);
export const canWork = (member) =>
  ["owner", "admin", "agent"].includes(member.role);
export function objectId(value) {
  if (!/^[a-f0-9]{24}$/i.test(String(value || ""))) throw fail("Invalid ID");
  return new mongoose.Types.ObjectId(value);
}
export async function workspaceAccess(req, res, next) {
  try {
    const workspace = await Workspace.findById(
      objectId(req.params.workspaceId),
    );
    const member = await Membership.findOne({
      workspace: workspace?._id,
      user: req.user._id,
      active: true,
    });
    if (!workspace || !member) throw fail("Workspace not found", 404);
    if (!(await seatAllowed(workspace, member)))
      throw fail(
        "Staff seat suspended after a plan change. Ask your workspace owner to increase seats.",
        403,
      );
    if (member.customRole) {
      requireFeature(workspace, "roles");
      const role = await CustomRole.findOne({
        _id: member.customRole,
        workspace: workspace._id,
      });
      if (!role) throw fail("Custom role unavailable", 403);
      req.permissions = role.permissions;
      const pieces = req.originalUrl
          .split("?")[0]
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent),
        segment =
          pieces[
            pieces.findIndex(
              (piece) => piece.toLowerCase() === String(workspace._id),
            ) + 1
          ];
      const area =
        {
          tickets: "tickets",
          contacts: "contacts",
          articles: "knowledge",
          resources: "tools",
          members: "team",
          invites: "team",
          connectors: "connections",
          channels: "connections",
          sso: "security",
          ai: "tools",
          "api-keys": "connections",
          jobs: "connections",
          billing: "billing",
          operations: "analytics",
          reports: "analytics",
          dashboards: "analytics",
          audit: "analytics",
          settings: "settings",
          security: "security",
          roles: "security",
          migration: "migration",
        }[segment] || "settings";
      const permission =
        area + "." + (["GET", "HEAD"].includes(req.method) ? "read" : "write");
      req.requiredPermission = permission;
      if (
        (segment || !["GET", "HEAD"].includes(req.method)) &&
        !role.permissions.includes(permission)
      )
        throw fail("Your custom role does not permit this operation", 403);
    }
    req.workspace = workspace;
    req.member = member;
    next();
  } catch (error) {
    next(error);
  }
}
export function permit(...roles) {
  return (req, res, next) =>
    roles.includes(req.member.role)
      ? next()
      : res.status(403).json({ error: "Insufficient workspace permissions" });
}
export async function ticketAccess(req, id, session) {
  const ticket = await Ticket.findOne({
    _id: objectId(id),
    workspace: req.workspace._id,
  }).session(session || null);
  if (!ticket) throw fail("Ticket not found", 404);
  if (req.member.role === "analyst")
    throw fail("Analysts can access reports, not private ticket content", 403);
  if (req.member.role === "customer") {
    const { Contact } = await import("./models.js");
    const contact = await Contact.findOne({
      _id: ticket.contact,
      workspace: req.workspace._id,
      email: req.user.email.toLowerCase(),
    }).session(session || null);
    if (!contact) throw fail("Ticket not found", 404);
  }
  return ticket;
}
export async function inWorkspace(workspaceId, callback) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const workspace = await Workspace.findOneAndUpdate(
        { _id: objectId(workspaceId) },
        { $inc: { revision: 1 } },
        { session, new: true },
      );
      if (!workspace) throw fail("Workspace not found", 404);
      result = await callback(session, workspace);
    });
    return result;
  } catch (error) {
    if (error.code === 20)
      throw fail(
        "Workspace writes require MongoDB Atlas or a replica set",
        503,
      );
    throw error;
  } finally {
    await session.endSession();
  }
}
export async function audit(
  workspace,
  actor,
  action,
  target,
  session,
  detail = {},
) {
  await Audit.create(
    [
      {
        workspace,
        actor: String(actor),
        action,
        target: String(target),
        detail,
      },
    ],
    { session },
  );
}
export async function assertSeat(workspace, session) {
  const seats =
    workspace.billing.plan !== "Free" &&
    workspace.billing.expiresAt > new Date() &&
    ["active", "trialing"].includes(workspace.billing.status)
      ? workspace.billing.seats
      : 2;
  const count = await Membership.countDocuments({
    workspace: workspace._id,
    active: true,
    role: { $ne: "customer" },
  }).session(session);
  if (count >= seats)
    throw fail(
      "Agent-seat limit reached. Upgrade the workspace or deactivate a staff member.",
      409,
    );
}
export async function withActor(req, callback) {
  const expectedRole = req.member.role;
  const expectedCustomRole = String(req.member.customRole || "");
  return inWorkspace(req.workspace._id, async (session, workspace) => {
    const member = await Membership.findOne({
      _id: req.member._id,
      workspace: workspace._id,
      user: req.user._id,
      active: true,
    }).session(session);
    if (
      !member ||
      member.role !== expectedRole ||
      String(member.customRole || "") !== expectedCustomRole
    )
      throw fail("Workspace access changed. Refresh and try again.", 403);
    if (!(await seatAllowed(workspace, member, session)))
      throw fail("Staff seat suspended", 403);
    if (member.customRole) {
      requireFeature(workspace, "roles");
      const role = await CustomRole.findOne({
        _id: member.customRole,
        workspace: workspace._id,
      }).session(session);
      if (
        !role ||
        (req.requiredPermission &&
          !role.permissions.includes(req.requiredPermission))
      )
        throw fail("Custom role access changed. Refresh and try again.", 403);
    }
    req.member = member;
    return callback(session, workspace);
  });
}

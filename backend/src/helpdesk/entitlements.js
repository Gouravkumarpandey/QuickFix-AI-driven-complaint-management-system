import { Membership, Workspace, Ticket } from "./models.js";
import { fail } from "./validation.js";
export const FEATURES = {
  Free: [
    "inbox",
    "knowledge",
    "portal",
    "mfa",
    "automation",
    "ai",
    "api",
    "channels",
  ],
  Pro: [
    "inbox",
    "knowledge",
    "portal",
    "mfa",
    "automation",
    "ai",
    "api",
    "channels",
    "analytics",
    "imap",
    "migration",
    "semantic",
  ],
  Premium: [
    "inbox",
    "knowledge",
    "portal",
    "mfa",
    "automation",
    "ai",
    "api",
    "channels",
    "analytics",
    "imap",
    "migration",
    "semantic",
    "sso",
    "roles",
    "social",
    "voice",
  ],
};
export function entitlement(workspace) {
  const paid =
    workspace.billing.plan !== "Free" &&
    workspace.billing.expiresAt > new Date() &&
    ["active", "trialing"].includes(workspace.billing.status);
  const plan =
    paid && FEATURES[workspace.billing.plan] ? workspace.billing.plan : "Free";
  return {
    plan,
    seats: plan === "Free" ? 2 : workspace.billing.seats,
    features: FEATURES[plan],
  };
}
export function requireFeature(workspace, feature) {
  if (!entitlement(workspace).features.includes(feature))
    throw fail(
      `Your workspace plan does not include ${feature}. Upgrade from Billing.`,
      402,
    );
}
export async function seatMembers(workspace, session) {
  const members = await Membership.find({
    workspace: workspace._id,
    active: true,
    role: { $ne: "customer" },
  })
    .session(session || null)
    .lean();
  members.sort(
    (a, b) =>
      (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) ||
      a.createdAt - b.createdAt ||
      String(a._id).localeCompare(String(b._id)),
  );
  return members;
}
export async function seatAllowed(workspace, member, session) {
  if (member.role === "customer") return true;
  return (await seatMembers(workspace, session))
    .slice(0, entitlement(workspace).seats)
    .some((m) => String(m._id) === String(member._id));
}
export async function reconcileSeats(workspace, session) {
  const members = await seatMembers(workspace, session),
    keep = members.slice(0, entitlement(workspace).seats).map((m) => m._id),
    suspend = members.slice(entitlement(workspace).seats).map((m) => m._id);
  await Membership.updateMany(
    { workspace: workspace._id, _id: { $in: keep } },
    { $set: { entitlementSuspended: false } },
    { session },
  );
  await Membership.updateMany(
    { workspace: workspace._id, _id: { $in: suspend } },
    { $set: { entitlementSuspended: true } },
    { session },
  );
  if (suspend.length)
    await Ticket.updateMany(
      {
        workspace: workspace._id,
        assignedTo: { $in: suspend },
        status: { $nin: ["Resolved", "Closed"] },
      },
      { $unset: { assignedTo: 1 }, $inc: { version: 1 } },
      { session },
    );
  return { allowed: keep.length, suspended: suspend.length };
}
export async function reconcileAllSeats() {
  for await (const workspace of Workspace.find().cursor())
    await reconcileSeats(workspace);
}

import crypto from "node:crypto";
import {
  Ticket,
  Message,
  Membership,
  Contact,
  Resource,
  Connector,
  Job,
} from "./models.js";
import { audit, canWork, objectId, ticketAccess } from "./access.js";
import { fail, validateFields } from "./validation.js";
import { initialSLA, transitionSLA, dueAt } from "./sla.js";
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export async function enqueue(workspace, kind, payload, key, session) {
  await Job.updateOne(
    { key },
    {
      $setOnInsert: {
        workspace,
        kind,
        payload,
        state: "queued",
        availableAt: new Date(),
      },
    },
    { upsert: true, session },
  );
}
export async function ticketEvent(workspace, ticket, event, session) {
  const connectors = await Connector.find({
    workspace,
    kind: { $in: ["slack", "webhook"] },
    enabled: true,
  }).session(session);
  for (const connector of connectors)
    await enqueue(
      workspace,
      connector.kind,
      {
        connector: connector._id,
        event,
        ticket: {
          id: ticket._id,
          number: ticket.number,
          status: ticket.status,
          priority: ticket.priority,
        },
        text: `${event}: ${ticket.number} — ${ticket.subject} (${ticket.priority}, ${ticket.status})`,
      },
      `slack:${connector._id}:${ticket._id}:${ticket.version}:${event}`,
      session,
    );
}
export function matches(condition, ticket) {
  const actual =
    condition.field === "slaBreached"
      ? ticket.sla.breached
      : ticket[condition.field];
  if (condition.operator === "eq") return actual === condition.value;
  if (condition.operator === "in")
    return Array.isArray(condition.value) && condition.value.includes(actual);
  return (Array.isArray(actual) ? actual.join(" ") : String(actual || ""))
    .toLowerCase()
    .includes(String(condition.value).toLowerCase());
}
export async function applyActions(workspace, ticket, actions, actor, session) {
  if (actions.status) {
    if (!workspace.settings.statuses.includes(actions.status))
      throw fail("Unknown status");
    transitionSLA(ticket, actions.status, workspace.settings);
    ticket.status = actions.status;
  }
  for (const key of ["priority", "group"])
    if (actions[key]) ticket[key] = actions[key];
  if (actions.tags)
    ticket.tags = [...new Set([...(ticket.tags || []), ...actions.tags])].slice(
      0,
      30,
    );
  if (actions.assignedTo !== undefined) {
    if (actions.assignedTo) {
      const agent = await Membership.findOne({
        _id: objectId(actions.assignedTo),
        workspace: workspace._id,
        active: true,
        role: { $in: ["owner", "admin", "agent"] },
      }).session(session);
      if (!agent) throw fail("Agent is not in this workspace");
      ticket.assignedTo = agent._id;
    } else ticket.assignedTo = null;
  }
  if (actions.reply)
    await addMessage(
      workspace,
      ticket,
      { text: actions.reply, internal: false },
      actor,
      "agent",
      session,
    );
}
export async function runAutomations(workspace, ticket, event, actor, session) {
  const rules = await Resource.find({
    workspace: workspace._id,
    kind: "automation",
    active: true,
    "value.event": event,
  })
    .sort({ createdAt: 1 })
    .session(session);
  for (const rule of rules) {
    const run = `${rule._id}:${ticket.version}:${event}`;
    if (
      ticket.automationRuns.includes(run) ||
      !rule.value.conditions.every((condition) => matches(condition, ticket))
    )
      continue;
    await applyActions(workspace, ticket, rule.value.actions, actor, session);
    ticket.automationRuns.push(run);
  }
  ticket.automationRuns = ticket.automationRuns.slice(-100);
}
export async function autoAssign(workspace, ticket, session) {
  if (ticket.assignedTo) return;
  const agents = await Membership.find({
    workspace: workspace._id,
    active: true,
    online: true,
    role: { $in: ["owner", "admin", "agent"] },
    groups: ticket.group,
  })
    .sort({ createdAt: 1 })
    .session(session);
  let selected,
    load = Infinity;
  for (const agent of agents) {
    const count = await Ticket.countDocuments({
      workspace: workspace._id,
      assignedTo: agent._id,
      status: { $nin: ["Resolved", "Closed"] },
      mergedInto: null,
    }).session(session);
    if (count < agent.capacity && count < load) {
      selected = agent;
      load = count;
    }
  }
  if (selected) ticket.assignedTo = selected._id;
}
export async function createTicket(
  workspace,
  input,
  actor,
  session,
  { connection, externalId, guest = false } = {},
) {
  const email = input.email.toLowerCase().trim();
  const contact = await Contact.findOneAndUpdate(
    { workspace: workspace._id, email },
    {
      $setOnInsert: { name: input.name || email },
      ...(input.phone ? { $set: { phone: input.phone } } : {}),
    },
    { upsert: true, new: true, session },
  );
  const rawToken = guest ? crypto.randomBytes(32).toString("hex") : null;
  const ticket = new Ticket({
    workspace: workspace._id,
    number: `QF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
    subject: input.subject,
    description: input.description,
    contact: contact._id,
    channel: input.channel || "web",
    priority: input.priority || "Medium",
    group: input.group || "General",
    tags: input.tags || [],
    customFields: validateFields(
      workspace.settings.customFields,
      input.customFields,
    ),
    sla: initialSLA(new Date(), workspace.settings),
    connection,
    guest,
    externalThread: input.threadId,
    ...(rawToken ? { guestTokenHash: digest(rawToken) } : {}),
  });
  const policies = await Resource.find({
    workspace: workspace._id,
    kind: "sla",
    active: true,
  })
    .sort({ createdAt: 1 })
    .session(session);
  const policy =
    policies.find((rule) =>
      rule.value.conditions.every((condition) => matches(condition, ticket)),
    )?.value.policy || workspace.settings.sla;
  ticket.sla = {
    ...initialSLA(new Date(), { ...workspace.settings, sla: policy }),
    policy,
  };
  await ticket.save({ session });
  await Message.create(
    [
      {
        workspace: workspace._id,
        ticket: ticket._id,
        author: email,
        authorRole: "customer",
        text: input.description,
        connection,
        externalId,
      },
    ],
    { session },
  );
  await runAutomations(workspace, ticket, "ticket.created", actor, session);
  await autoAssign(workspace, ticket, session);
  await ticket.save({ session });
  await audit(workspace._id, actor, "ticket.created", ticket._id, session);
  await ticketEvent(workspace._id, ticket, "ticket.created", session);
  return { ticket, accessToken: rawToken };
}
export async function addMessage(
  workspace,
  ticket,
  input,
  actor,
  role,
  session,
  { externalId, connection } = {},
) {
  if (ticket.mergedInto) throw fail("Ticket has been merged", 409);
  if (input.internal && role === "customer")
    throw fail("Customers cannot add private notes", 403);
  const [message] = await Message.create(
    [
      {
        workspace: workspace._id,
        ticket: ticket._id,
        author: String(actor),
        authorRole: role,
        text: input.text,
        internal: input.internal || false,
        connection,
        externalId,
        attachments: input.attachments || [],
        delivery:
          !input.internal && role !== "customer" && ticket.connection
            ? "queued"
            : "stored",
      },
    ],
    { session },
  );
  const now = new Date(),
    slaSettings = {
      ...workspace.settings,
      sla: ticket.sla.policy || workspace.settings.sla,
    };
  if (role === "customer") {
    if (workspace.settings.pauseStatuses.includes(ticket.status)) {
      transitionSLA(ticket, "Open", workspace.settings, now);
      ticket.status = "Open";
    }
    if (["Resolved", "Closed"].includes(ticket.status)) {
      ticket.status = "Open";
      ticket.sla.resolvedAt = undefined;
      ticket.sla.resolutionDue = dueAt(
        now,
        slaSettings.sla.resolution,
        slaSettings,
      );
    }
    ticket.sla.nextDue = dueAt(now, slaSettings.sla.nextResponse, slaSettings);
    await runAutomations(workspace, ticket, "customer.replied", actor, session);
  } else if (!input.internal) {
    ticket.sla.firstRespondedAt ||= now;
    ticket.sla.nextDue = undefined;
  }
  ticket.version++;
  if (message.delivery === "queued")
    await enqueue(
      workspace._id,
      "reply",
      {
        ticket: ticket._id,
        message: message._id,
        connector: ticket.connection,
      },
      `reply:${message._id}`,
      session,
    );
  await ticket.save({ session });
  return message;
}
export async function updateTicket(req, id, input, session, workspace) {
  const ticket = await ticketAccess(req, id, session);
  if (!canWork(req.member)) throw fail("Staff access required", 403);
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== ticket.version
  )
    throw fail(
      "Another agent updated this ticket. Refresh before saving.",
      409,
    );
  if (input.customFields !== undefined)
    ticket.customFields = validateFields(
      workspace.settings.customFields,
      input.customFields,
    );
  await applyActions(workspace, ticket, input, req.user._id, session);
  ticket.version++;
  await runAutomations(
    workspace,
    ticket,
    "ticket.updated",
    req.user._id,
    session,
  );
  await autoAssign(workspace, ticket, session);
  await ticket.save({ session });
  await audit(
    workspace._id,
    req.user._id,
    "ticket.updated",
    ticket._id,
    session,
  );
  await ticketEvent(workspace._id, ticket, "ticket.updated", session);
  return ticket;
}

import crypto from "node:crypto";
import { sendWebhook } from "./webhooks.js";
import nodemailer from "nodemailer";
import {
  Connector,
  Job,
  Ticket,
  Message,
  Contact,
  Workspace,
} from "./models.js";
import { decrypt } from "./connectors.js";
import { inWorkspace, audit } from "./access.js";
import { runAutomations, ticketEvent, digest } from "./tickets.js";
export async function deliver(
  job,
  { fetcher = fetch, mailer, webhookSender = sendWebhook } = {},
) {
  if (job.kind === "verify.email") {
    const ticket = await Ticket.findOne({
      _id: job.payload.ticket,
      workspace: job.workspace,
    }).select("+emailVerifyHash");
    const proof = decrypt(job.payload.proof);
    if (
      !ticket ||
      ticket.guestVerified ||
      ticket.emailVerifyHash !== digest(proof) ||
      ticket.emailVerifyExpires < new Date()
    )
      return;
    const customer = await Contact.findOne({
        _id: ticket.contact,
        workspace: job.workspace,
      }),
      workspace = await Workspace.findById(job.workspace);
    if (!customer || !workspace)
      throw new Error("Verification customer not found");
    if (!mailer) {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)
        throw new Error("SMTP is not configured");
      mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
    }
    const url = `${new URL(process.env.FRONTEND_URL || "http://localhost:5173").origin}/support/${workspace.slug}?verify=${proof}&ticket=${ticket._id}`;
    await mailer.sendMail({
      from: process.env.EMAIL_USER,
      to: customer.email,
      subject: `Verify your support request ${ticket.number}`,
      text: `Open this link to verify your email and access your support conversation. It expires in 30 minutes. If you did not request support, ignore this message.\n\n${url}`,
      messageId: `<quickfix-verify-${job._id}@${(process.env.EMAIL_USER || "support@quickfix.local").split("@")[1]}>`,
    });
    return;
  }
  const connector = await Connector.findOne({
    _id: job.payload.connector,
    workspace: job.workspace,
    enabled: true,
  }).select("+token +secret");
  if (!connector) throw new Error("Connector disabled or removed");
  if (job.kind === "webhook") {
    const body = JSON.stringify({
      event: job.payload.event,
      workspace: String(job.workspace),
      ticket: job.payload.ticket,
    });
    await webhookSender(decrypt(connector.config.webhookUrl), body, {
      "X-QuickFix-Signature":
        "sha256=" +
        crypto
          .createHmac("sha256", decrypt(connector.secret))
          .update(body)
          .digest("hex"),
      "X-QuickFix-Event-Id": String(job._id),
    });
    return;
  }
  if (job.kind === "slack") {
    const response = await fetcher(decrypt(connector.config.slackUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: String(job.payload.text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;"),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`Slack delivery failed (${response.status})`);
    return;
  }
  const message = await Message.findOne({
      _id: job.payload.message,
      workspace: job.workspace,
    }),
    ticket = await Ticket.findOne({
      _id: job.payload.ticket,
      workspace: job.workspace,
    });
  if (!message || !ticket || message.internal)
    throw new Error("Invalid outbound message");
  const contact = await Contact.findOne({
    _id: ticket.contact,
    workspace: job.workspace,
  });
  if (!contact) throw new Error("Customer not found");
  if (connector.kind === "email") {
    if (!mailer) {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)
        throw new Error("SMTP is not configured");
      mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
    }
    await mailer.sendMail({
      from: process.env.EMAIL_USER,
      to: contact.email,
      replyTo: connector.config.fromAddress || process.env.EMAIL_USER,
      subject: `Re: [${ticket.number}] ${ticket.subject}`,
      text: message.text,
      messageId: `<quickfix-${message._id}@${(process.env.EMAIL_USER || "support@quickfix.local").split("@")[1]}>`,
      headers: {
        "X-QuickFix-Thread": ticket.externalThread || String(ticket._id),
      },
    });
  } else if (connector.kind === "whatsapp") {
    const phone = contact.phone;
    if (!/^\d{8,15}$/.test(phone || ""))
      throw new Error("Invalid WhatsApp customer number");
    const response = await fetcher(
      `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}/${connector.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${decrypt(connector.token)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: message.text },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `WhatsApp delivery failed (${response.status}); check the customer-service window and template requirements`,
      );
  } else throw new Error("Unsupported reply channel");
  message.delivery = "sent";
  await message.save();
}
export async function drainJobs(dependencies = {}, limit = 20) {
  // A worker may die during its final attempt. Make that job visible for manual retry.
  await Job.updateMany(
    {
      state: "processing",
      attempts: { $gte: 5 },
      lockedUntil: { $lt: new Date() },
    },
    {
      $set: {
        state: "failed",
        lastError: "Worker lease expired during the final attempt",
      },
      $unset: { lockedUntil: 1 },
    },
  );
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const now = new Date(),
      job = await Job.findOneAndUpdate(
        {
          state: { $in: ["queued", "processing"] },
          availableAt: { $lte: now },
          $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
          attempts: { $lt: 5 },
        },
        {
          $set: {
            state: "processing",
            lockedUntil: new Date(Date.now() + 60000),
          },
          $inc: { attempts: 1 },
        },
        { new: true, sort: { availableAt: 1 } },
      );
    if (!job) break;
    try {
      await deliver(job, dependencies);
      job.state = "sent";
      job.lastError = undefined;
    } catch (error) {
      job.lastError = String(error.message).slice(0, 500);
      job.state = job.attempts >= 5 ? "failed" : "queued";
      job.availableAt = new Date(
        Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
      );
      if (job.payload.message)
        await Message.updateOne(
          { _id: job.payload.message, workspace: job.workspace },
          { $set: { delivery: job.state === "failed" ? "failed" : "queued" } },
        );
    }
    job.lockedUntil = undefined;
    await job.save();
    processed++;
  }
  return processed;
}
export async function checkSLAs(limit = 100) {
  const now = new Date(),
    tickets = await Ticket.find({
      status: { $nin: ["Resolved", "Closed"] },
      mergedInto: null,
      "sla.pausedAt": null,
      $or: [
        { "sla.firstDue": { $lt: now }, "sla.firstRespondedAt": null },
        { "sla.nextDue": { $lt: now } },
        { "sla.resolutionDue": { $lt: now } },
      ],
    }).cursor();
  let count = 0;
  for await (const item of tickets) {
    // Do not let previously reported overdue tickets starve later tickets.
    const observed = [
      !item.sla.firstRespondedAt && item.sla.firstDue,
      item.sla.nextDue,
      item.sla.resolutionDue,
    ]
      .filter((date) => date && date < now)
      .map((date) => date.toISOString())
      .sort()
      .join(":");
    if (!observed || item.sla.lastBreachKey === observed) continue;
    await inWorkspace(item.workspace, async (session, workspace) => {
      const ticket = await Ticket.findOne({
        _id: item._id,
        workspace: workspace._id,
      }).session(session);
      if (!ticket || ticket.sla.pausedAt || ticket.sla.resolvedAt) return;
      const due = [
        !ticket.sla.firstRespondedAt && ticket.sla.firstDue,
        ticket.sla.nextDue,
        ticket.sla.resolutionDue,
      ]
        .filter((date) => date && date < now)
        .map((date) => date.toISOString())
        .sort()
        .join(":");
      if (!due || ticket.sla.lastBreachKey === due) return;
      ticket.sla.breached = true;
      ticket.sla.lastBreachKey = due;
      ticket.version++;
      await runAutomations(
        workspace,
        ticket,
        "sla.breached",
        "system",
        session,
      );
      await ticket.save({ session });
      await ticketEvent(workspace._id, ticket, "sla.breached", session);
      await audit(workspace._id, "system", "sla.breached", ticket._id, session);
      count++;
    });
    if (count >= limit) break;
  }
  await tickets.close();
  return count;
}

import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { jwtSecret } from "../services/tokenService.js";
import {
  CustomerEmailOTP,
  CustomerEmailLimit,
  Contact,
  Ticket,
  Workspace,
  Message,
  Connector,
} from "./models.js";
import { encrypt, decrypt } from "./connectors.js";
import { enqueue, digest } from "./tickets.js";
import { fail } from "./validation.js";
export const otpHash = (workspace, ticket, challenge, code) =>
  crypto
    .createHmac("sha256", jwtSecret())
    .update(`${workspace}:${ticket}:${challenge}:${code}`)
    .digest("hex");
export async function queueCustomerOTP(workspace, ticket, session) {
  const now = new Date(),
    old = await CustomerEmailOTP.findOne({
      workspace: workspace._id,
      ticket: ticket._id,
    }).session(session);
  if (old?.sentAt > new Date(Date.now() - 60000))
    throw fail("Wait 60 seconds before requesting another email OTP", 429);
  const contact = await Contact.findOne({
    _id: ticket.contact,
    workspace: workspace._id,
  }).session(session);
  if (!contact) throw fail("Customer not found", 404);
  let limit = await CustomerEmailLimit.findOne({
    workspace: workspace._id,
    emailHash: digest(contact.email),
  }).session(session);
  if (limit && limit.expiresAt > now && limit.count >= 5)
    throw fail("Email OTP limit reached. Try again in one hour", 429);
  if (!limit)
    limit = new CustomerEmailLimit({
      workspace: workspace._id,
      emailHash: digest(contact.email),
    });
  if (!limit.expiresAt || limit.expiresAt <= now) {
    limit.count = 0;
    limit.expiresAt = new Date(Date.now() + 3600000);
  }
  limit.count++;
  await limit.save({ session });
  const challenge = crypto.randomBytes(32).toString("hex"),
    code = String(crypto.randomInt(100000, 1000000));
  await CustomerEmailOTP.findOneAndUpdate(
    { workspace: workspace._id, ticket: ticket._id },
    {
      $set: {
        challengeHash: digest(challenge),
        codeHash: otpHash(workspace._id, ticket._id, challenge, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + 600000),
        sentAt: now,
      },
    },
    { upsert: true, session },
  );
  await enqueue(
    workspace._id,
    "customer.email-otp",
    {
      ticket: ticket._id,
      challengeHash: digest(challenge),
      code: encrypt(code),
    },
    `customer-otp:${ticket._id}:${digest(challenge)}`,
    session,
  );
  return { challenge, expiresIn: 600, resendAfter: 60 };
}
export function customerMailer(mailer) {
  if (mailer) return mailer;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)
    throw new Error("SMTP is not configured");
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    requireTLS: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}
export async function deliverCustomerEmail(job, mailer) {
  const ticket = await Ticket.findOne({
    _id: job.payload.ticket,
    workspace: job.workspace,
  });
  if (!ticket) return;
  if (job.kind === "customer.email-otp") {
    const otp = await CustomerEmailOTP.findOne({
      workspace: job.workspace,
      ticket: ticket._id,
      challengeHash: job.payload.challengeHash,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 },
    });
    if (!otp) return;
  } else if (!ticket.guestVerified) return;
  const customer = await Contact.findOne({
      _id: ticket.contact,
      workspace: job.workspace,
    }),
    workspace = await Workspace.findById(job.workspace);
  if (!customer || !workspace) throw new Error("Email customer not found");
  let from = process.env.EMAIL_USER;
  let configuredMailer = mailer;
  if (!configuredMailer && ticket.connection) {
    const connector = await Connector.findOne({
      _id: ticket.connection,
      workspace: job.workspace,
      kind: "email",
      enabled: true,
    });
    if (connector) {
      const { replyTransport } = await import("./mailAuth.js");
      const transport = await replyTransport(connector);
      configuredMailer = transport.mailer;
      from = transport.user;
    }
  }
  const transport = () => customerMailer(configuredMailer);
  const messageId = `<quickfix-${job.kind.replaceAll(".", "-")}-${job._id}@${(process.env.EMAIL_USER || "support@quickfix.local").split("@")[1]}>`;
  if (job.kind === "customer.email-otp") {
    const code = decrypt(job.payload.code);
    await transport().sendMail({
      from,
      to: customer.email,
      subject: `Your support email OTP · ${ticket.number}`,
      text: `Your email verification OTP is ${code}. It expires in 10 minutes. Never share this OTP with anyone. If you did not request it, ignore this email.\n\n${workspace.name} support\nOpen your conversation: ${new URL(process.env.FRONTEND_URL || "http://localhost:5173").origin}/support/${workspace.slug}?ticket=${ticket._id}`,
      messageId,
    });
    return;
  }
  if (!ticket.guestVerified) return;
  const message = await Message.findOne({
    _id: job.payload.message,
    ticket: ticket._id,
    workspace: job.workspace,
    internal: false,
    authorRole: { $ne: "customer" },
  });
  if (!message) return;
  const url = `${new URL(process.env.FRONTEND_URL || "http://localhost:5173").origin}/support/${workspace.slug}?ticket=${ticket._id}`;
  await transport().sendMail({
    from,
    to: customer.email,
    subject: `Support reply · ${ticket.number}`,
    text: `${message.text}\n\nOpen your conversation: ${url}\nUse the email OTP to access it from a new browser. Attachments are available securely inside the conversation.`,
    messageId,
  });
  await Message.updateOne(
    { _id: message._id, workspace: job.workspace },
    { $set: { delivery: "sent" } },
  );
}

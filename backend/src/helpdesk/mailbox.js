import dns from "node:dns/promises";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Connector, Message, Attachment, Workspace, Audit } from "./models.js";
import { workspaceAccess, permit, objectId, inWorkspace } from "./access.js";
import { encrypt, decrypt, receive } from "./connectors.js";
import { requireFeature } from "./entitlements.js";
import { mimeOf, scan } from "./attachments.js";
import { publicIPv4 } from "./webhooks.js";
import { validate, fail } from "./validation.js";
export async function inboundFile(
  workspaceId,
  ticketId,
  messageId,
  { content, filename },
  scanner = scan,
) {
  if (
    !Buffer.isBuffer(content) ||
    content.length > 10 * 1024 ** 2 ||
    !content.length
  )
    throw fail("Inbound attachment exceeds the 10 MB limit");
  const mime = mimeOf(content);
  await scanner(content);
  const hash = crypto.createHash("sha256").update(content).digest("hex"),
    directory = path.resolve(
      process.env.PRIVATE_UPLOAD_DIR || "./private-uploads",
    ),
    storageKey = crypto.randomUUID();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, storageKey), content, {
    mode: 0o600,
    flag: "wx",
  });
  let keep = false;
  try {
    const result = await inWorkspace(
      workspaceId,
      async (session, workspace) => {
        const existing = await Attachment.findOne({
          workspace: workspaceId,
          ticket: ticketId,
          sha256: hash,
        }).session(session);
        if (existing) return existing;
        const [usage] = await Attachment.aggregate([
          { $match: { workspace: workspace._id } },
          { $group: { _id: null, bytes: { $sum: "$size" } } },
        ]).session(session);
        const paid =
            workspace.billing.plan !== "Free" &&
            workspace.billing.expiresAt > new Date() &&
            ["active", "trialing"].includes(workspace.billing.status),
          quota = paid ? 10 * 1024 ** 3 : 100 * 1024 ** 2;
        if ((usage?.bytes || 0) + content.length > quota)
          throw fail("Attachment storage quota exceeded", 409);
        const [file] = await Attachment.create(
          [
            {
              workspace: workspaceId,
              ticket: ticketId,
              name: String(filename || "attachment")
                .replace(/[\r\n/\\]/g, "_")
                .slice(0, 150),
              mime,
              size: content.length,
              internal: false,
              storageKey,
              sha256: hash,
              uploadedBy: workspaceId,
            },
          ],
          { session },
        );
        await Message.updateOne(
          { _id: messageId, workspace: workspaceId, ticket: ticketId },
          { $addToSet: { attachments: file._id } },
          { session },
        );
        return file;
      },
    );
    keep = result.storageKey === storageKey;
    return result;
  } finally {
    if (!keep) await unlink(path.join(directory, storageKey)).catch(() => {});
  }
}
export async function importRawMail(
  connector,
  source,
  { scanner = scan, externalId } = {},
) {
  if (source.length > 20 * 1024 ** 2)
    throw fail("Email exceeds the 20 MB limit");
  const mail = await simpleParser(source, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      maxHtmlLengthToParse: 1024 * 1024,
    }),
    sender = mail.from?.value?.[0];
  const email = validate(
      Joi.string().email().lowercase().required(),
      sender?.address,
    ),
    messageId = String(
      mail.messageId ||
        externalId ||
        crypto.createHash("sha256").update(source).digest("hex"),
    ).slice(0, 300),
    text = String(
      mail.text ||
        convert(mail.html || "", {
          wordwrap: 100,
          selectors: [
            { selector: "img", format: "skip" },
            { selector: "a", options: { ignoreHref: true } },
          ],
        }) ||
        "(Message contains attachments)",
    ).slice(0, 10000);
  const references = [
    ...(Array.isArray(mail.references)
      ? mail.references
      : mail.references
        ? [mail.references]
        : []),
    ...(mail.inReplyTo ? [mail.inReplyTo] : []),
  ];
  const parent =
    references.length &&
    (await Message.findOne({
      workspace: connector.workspace,
      connection: connector._id,
      externalId: { $in: references },
    }).sort({ createdAt: 1 }));
  let subject = String(mail.subject || "Email support request").slice(0, 200);
  if (parent) {
    const { Ticket } = await import("./models.js"),
      ticket = await Ticket.findById(parent.ticket);
    if (ticket) subject = `[${ticket.number}] ${subject}`.slice(0, 200);
  }
  const result = await receive(connector, {
    messageId,
    email,
    name: sender.name?.slice(0, 100),
    subject: subject.length < 3 ? "Email support request" : subject,
    description: text,
  });
  const message = await Message.findOne({
    workspace: connector.workspace,
    connection: connector._id,
    externalId: messageId,
  });
  if (!message) throw fail("Email was not stored", 503);
  for (const file of (mail.attachments || []).slice(0, 10)) {
    try {
      await inboundFile(
        connector.workspace,
        message.ticket,
        message._id,
        { content: file.content, filename: file.filename },
        scanner,
      );
    } catch (error) {
      await Audit.create({
        workspace: connector.workspace,
        actor: "mailbox",
        action: "attachment.rejected",
        target: String(message.ticket),
        detail: { reason: "File rejected, unsupported or scanner unavailable" },
      });
      if (error.statusCode === 503) throw error;
    }
  }
  return { ...result, ticket: message.ticket };
}
export async function syncMailbox(
  connector,
  {
    clientFactory = (options) => new ImapFlow(options),
    resolver = dns.resolve4,
  } = {},
) {
  const workspace = await Workspace.findById(connector.workspace);
  requireFeature(workspace, "imap");
  const config = connector.config.imap;
  if (!config) throw fail("Mailbox not configured", 409);
  const allowed = String(process.env.IMAP_ALLOWED_HOSTS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase());
  if (!allowed.includes(config.host))
    throw fail("Mailbox host must be enabled by the operator", 503);
  const addresses = await resolver(config.host);
  if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
    throw fail("Mailbox resolves to a private address");
  const client = clientFactory({
    host: addresses[0],
    servername: config.host,
    port: 993,
    secure: true,
    auth: { user: config.user, pass: decrypt(connector.token) },
    logger: false,
    tls: { servername: config.host, rejectUnauthorized: true },
    connectionTimeout: 15000,
    socketTimeout: 30000,
    maxLiteralSize: 20 * 1024 ** 2,
    maxResponseSize: 25 * 1024 ** 2,
    disableAutoIdle: true,
  });
  let lock,
    count = 0;
  try {
    await client.connect();
    lock = await client.getMailboxLock(config.mailbox || "INBOX", {
      readOnly: true,
    });
    const validity = String(client.mailbox.uidValidity),
      cursor =
        connector.cursor?.validity === validity ? connector.cursor.uid : 0;
    const uids = (
      await client.search({ uid: `${(cursor || 0) + 1}:*` }, { uid: true })
    )
      .filter((uid) => uid > (cursor || 0))
      .slice(0, 25);
    for (const uid of uids) {
      const mail = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!mail?.source) continue;
      await importRawMail(connector, mail.source, {
        externalId: `imap:${validity}:${uid}`,
      });
      await Connector.updateOne(
        { _id: connector._id, workspace: connector.workspace },
        { $set: { cursor: { validity, uid } } },
      );
      count++;
    }
    await Connector.updateOne(
      { _id: connector._id },
      { $set: { lastSyncAt: new Date() }, $unset: { syncError: 1 } },
    );
    return { imported: count };
  } finally {
    lock?.release();
    client.close();
  }
}
export async function syncMailboxes() {
  for await (const candidate of Connector.find({
    kind: "email",
    enabled: true,
    "config.imap": { $exists: true },
    $or: [
      { lastSyncAt: null },
      { lastSyncAt: { $lt: new Date(Date.now() - 60000) } },
    ],
  }).cursor()) {
    const connector = await Connector.findOneAndUpdate(
      {
        _id: candidate._id,
        $or: [
          { syncLockedUntil: null },
          { syncLockedUntil: { $lt: new Date() } },
        ],
      },
      { $set: { syncLockedUntil: new Date(Date.now() + 180000) } },
      { new: true },
    ).select("+token");
    if (!connector) continue;
    try {
      await syncMailbox(connector);
    } catch (error) {
      await Connector.updateOne(
        { _id: connector._id },
        {
          $set: {
            syncError:
              "Mailbox sync failed. Check host, credentials, scanner and plan.",
            lastSyncAt: new Date(),
          },
        },
      );
    } finally {
      await Connector.updateOne(
        { _id: connector._id },
        { $unset: { syncLockedUntil: 1 } },
      );
    }
  }
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.put(
  "/:workspaceId/connectors/:connectorId/mailbox",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "imap");
    const input = validate(
      Joi.object({
        host: Joi.string().hostname().lowercase().required(),
        user: Joi.string().max(200).required(),
        password: Joi.string().max(2000).required(),
        mailbox: Joi.string().max(100).default("INBOX"),
      }),
      req.body,
    );
    if (
      !String(process.env.IMAP_ALLOWED_HOSTS || "")
        .split(",")
        .map((v) => v.trim())
        .includes(input.host)
    )
      throw fail(
        "Ask the operator to add this provider to IMAP_ALLOWED_HOSTS",
        503,
      );
    const connector = await Connector.findOne({
      _id: objectId(req.params.connectorId),
      workspace: req.workspace._id,
      kind: "email",
    });
    if (!connector) throw fail("Email connection not found", 404);
    connector.config = {
      ...connector.config,
      imap: { host: input.host, user: input.user, mailbox: input.mailbox },
    };
    connector.token = encrypt(input.password);
    connector.cursor = undefined;
    connector.lastSyncAt = undefined;
    await connector.save();
    res.json({ configured: true });
  }),
);
router.post(
  "/:workspaceId/connectors/:connectorId/import-email",
  permit("owner", "admin"),
  express.raw({ type: "message/rfc822", limit: "20mb" }),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "imap");
    const connector = await Connector.findOne({
      _id: objectId(req.params.connectorId),
      workspace: req.workspace._id,
      kind: "email",
      enabled: true,
    });
    if (!connector) throw fail("Email connection not found", 404);
    if (!Buffer.isBuffer(req.body)) throw fail("Upload an RFC 822 .eml file");
    res.json(await importRawMail(connector, req.body));
  }),
);
export default router;

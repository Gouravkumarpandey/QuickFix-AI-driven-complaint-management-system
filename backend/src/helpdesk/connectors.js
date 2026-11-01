import { webhookURL } from "./webhooks.js";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import express from "express";
import Joi from "joi";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { authenticate } from "../middleware/auth.js";
import { Connector, Message, Ticket, Contact } from "./models.js";
import { workspaceAccess, permit, objectId, inWorkspace } from "./access.js";
import { fail, validate, text } from "./validation.js";
import { createTicket, addMessage, digest } from "./tickets.js";
function key() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw))
    throw fail(
      "Configure INTEGRATION_ENCRYPTION_KEY before connecting external channels",
      503,
    );
  return Buffer.from(raw, "hex");
}
export function encrypt(value) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    body.toString("hex"),
  ].join(".");
}
export function decrypt(value) {
  const [iv, tag, body] = value.split(".");
  const cipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export function signatureOK(secret, raw, signature) {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature || "")) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export const connectorRoutes = express.Router();
connectorRoutes.use(authenticate);
connectorRoutes.use("/:workspaceId", workspaceAccess);
connectorRoutes.get(
  "/:workspaceId/connectors",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json(await Connector.find({ workspace: req.workspace._id }).lean()),
  ),
);
connectorRoutes.post(
  "/:workspaceId/connectors",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        kind: Joi.string()
          .valid(
            "email",
            "whatsapp",
            "slack",
            "shopify",
            "shiprocket",
            "webhook",
          )
          .required(),
        name: Joi.string().min(2).max(100).required(),
        token: Joi.string().max(2000),
        appSecret: Joi.string().max(500),
        phoneNumberId: Joi.string().pattern(/^\d+$/),
        slackUrl: Joi.string().pattern(
          /^https:\/\/hooks\.slack\.com\/services\/[a-zA-Z0-9/_-]+$/,
        ),
        webhookUrl: Joi.string().max(2000),
        fromAddress: Joi.string().email(),
        shopDomain: Joi.string().pattern(
          /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/,
        ),
      }),
      req.body,
    );
    if (
      input.kind === "whatsapp" &&
      (!input.token || !input.appSecret || !input.phoneNumberId)
    )
      throw fail("WhatsApp token, app secret and phone number ID are required");
    if (input.kind === "webhook") webhookURL(input.webhookUrl);
    if (input.kind === "shopify" && (!input.token || !input.shopDomain))
      throw fail("Shopify shop domain and Admin API access token are required");
    if (input.kind === "shiprocket" && !input.token)
      throw fail("Shiprocket bearer token is required");
    if (input.kind === "slack" && !input.slackUrl)
      throw fail("Slack webhook URL is required");
    const secret = input.appSecret || crypto.randomBytes(32).toString("hex"),
      verifyToken = crypto.randomBytes(24).toString("hex");
    const connector = await Connector.create({
      workspace: req.workspace._id,
      kind: input.kind,
      name: input.name,
      secret: encrypt(secret),
      token: input.token ? encrypt(input.token) : undefined,
      verifyTokenHash: digest(verifyToken),
      config: {
        webhookUrl: input.webhookUrl ? encrypt(input.webhookUrl) : undefined,
        shopDomain: input.shopDomain,
        phoneNumberId: input.phoneNumberId,
        slackUrl: input.slackUrl ? encrypt(input.slackUrl) : undefined,
        fromAddress: input.fromAddress,
      },
    });
    res
      .status(201)
      .json({
        id: connector._id,
        ...(["email", "whatsapp"].includes(input.kind)
          ? { webhookPath: `/api/channels/${connector._id}` }
          : {}),
        ...(["email", "webhook"].includes(input.kind)
          ? { webhookSecret: secret }
          : {}),
        ...(input.kind === "whatsapp" ? { verifyToken } : {}),
      });
  }),
);
connectorRoutes.patch(
  "/:workspaceId/connectors/:connectorId",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({ enabled: Joi.boolean().required() }),
      req.body,
    );
    const connector = await Connector.findOneAndUpdate(
      { _id: objectId(req.params.connectorId), workspace: req.workspace._id },
      { $set: input },
      { new: true },
    );
    if (!connector) throw fail("Connector not found", 404);
    res.json({ id: connector._id, enabled: connector.enabled });
  }),
);
async function receive(connector, input) {
  try {
    return await inWorkspace(
      connector.workspace,
      async (session, workspace) => {
        if (
          await Message.exists({
            workspace: workspace._id,
            connection: connector._id,
            externalId: input.messageId,
          }).session(session)
        )
          return { duplicate: true };
        const number = input.subject.match(/\[(QF-[A-F0-9]{12})\]/)?.[1],
          threads = [
            ...(input.threadId ? [{ externalThread: input.threadId }] : []),
            ...(number ? [{ number }] : []),
          ];
        let ticket = threads.length
          ? await Ticket.findOne({
              workspace: workspace._id,
              connection: connector._id,
              mergedInto: null,
              $or: threads,
            }).session(session)
          : null;
        if (ticket) {
          const contact = await Contact.findOne({
            _id: ticket.contact,
            workspace: workspace._id,
          }).session(session);
          if (contact.email !== input.email.toLowerCase()) ticket = null;
        }
        if (ticket) {
          await addMessage(
            workspace,
            ticket,
            { text: input.description },
            input.email,
            "customer",
            session,
            { connection: connector._id, externalId: input.messageId },
          );
          return { ticket: ticket._id };
        }
        const result = await createTicket(
          workspace,
          { ...input, channel: connector.kind },
          "channel",
          session,
          { connection: connector._id, externalId: input.messageId },
        );
        return { ticket: result.ticket._id };
      },
    );
  } catch (error) {
    if (error.code === 11000) return { duplicate: true };
    throw error;
  }
}
export const channelRoutes = express.Router();
channelRoutes.use(
  rateLimit({
    windowMs: 60000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
channelRoutes.get(
  "/:connectorId",
  wrap(async (req, res) => {
    const connector = await Connector.findOne({
      _id: objectId(req.params.connectorId),
      enabled: true,
      kind: "whatsapp",
    }).select("+verifyTokenHash");
    if (
      !connector ||
      req.query["hub.mode"] !== "subscribe" ||
      digest(String(req.query["hub.verify_token"] || "")) !==
        connector.verifyTokenHash
    )
      throw fail("Invalid verification token", 403);
    res.type("text/plain").send(String(req.query["hub.challenge"] || ""));
  }),
);
channelRoutes.post(
  "/:connectorId",
  express.raw({ type: "application/json", limit: "1mb" }),
  wrap(async (req, res) => {
    const connector = await Connector.findOne({
      _id: objectId(req.params.connectorId),
      enabled: true,
    }).select("+secret");
    if (!connector || !["email", "whatsapp"].includes(connector.kind))
      throw fail("Channel not found", 404);
    if (
      !Buffer.isBuffer(req.body) ||
      !signatureOK(
        decrypt(connector.secret),
        req.body,
        req.get(
          connector.kind === "whatsapp"
            ? "X-Hub-Signature-256"
            : "X-QuickFix-Signature",
        ),
      )
    )
      throw fail("Invalid webhook signature", 401);
    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      throw fail("Invalid JSON");
    }
    if (connector.kind === "email") {
      const input = validate(
        Joi.object({
          messageId: Joi.string().min(1).max(300).required(),
          threadId: Joi.string().max(300),
          email: Joi.string().email().lowercase().required(),
          name: Joi.string().max(100),
          subject: Joi.string().min(3).max(200).required(),
          description: text.min(1).required(),
        }),
        payload,
      );
      res.json(await receive(connector, input));
      return;
    }
    for (const entry of payload.entry || [])
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (
          String(value.metadata?.phone_number_id) !==
          String(connector.config.phoneNumberId)
        )
          continue;
        for (const message of value.messages || []) {
          if (message.type !== "text") continue;
          const phone = String(message.from);
          if (!/^\d{8,15}$/.test(phone)) continue;
          await receive(connector, {
            messageId: message.id,
            threadId: phone,
            email: `wa-${phone}@whatsapp.invalid`,
            phone,
            name: value.contacts?.[0]?.profile?.name || phone,
            subject: "WhatsApp support request",
            description: String(message.text?.body || "").slice(0, 10000),
          });
        }
      }
    res.json({ received: true });
  }),
);

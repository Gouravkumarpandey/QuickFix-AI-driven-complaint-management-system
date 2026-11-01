import express from "express";
import Joi from "joi";
import twilio from "twilio";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  Connector,
  Workspace,
  Ticket,
  Contact,
  Message,
  Attachment,
  ChannelIdentity,
} from "./models.js";
import { encrypt, decrypt, receive, signatureOK } from "./connectors.js";
import {
  workspaceAccess,
  permit,
  objectId,
  ticketAccess,
  withActor,
  audit,
} from "./access.js";
import { requireFeature } from "./entitlements.js";
import { addMessage, digest } from "./tickets.js";
import { Job } from "./models.js";
import { inboundFile } from "./mailbox.js";
import { validate, fail, text } from "./validation.js";
const graph = () => process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
export async function boundedBody(response, max = 10 * 1024 ** 2) {
  if (!response.ok) throw fail("Provider download failed", 502);
  if (Number(response.headers.get("content-length")) > max)
    throw fail("Provider file exceeds size limit");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) throw fail("Provider file exceeds size limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function receiveWhatsAppMedia(
  connector,
  payload,
  fetcher = fetch,
) {
  const token = decrypt(connector.token),
    metadata = await fetcher(
      `https://graph.facebook.com/${graph()}/${encodeURIComponent(payload.mediaId)}`,
      {
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(15000),
      },
    );
  if (!metadata.ok) throw fail("Media lookup failed", 502);
  const data = await metadata.json(),
    url = new URL(data.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(
      url.hostname === "lookaside.fbsbx.com" ||
      url.hostname.endsWith(".fbcdn.net")
    )
  )
    throw fail("Unexpected provider media host", 502);
  const content = await boundedBody(
    await fetcher(url.href, {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }),
  );
  const message = await Message.findOne({
    workspace: connector.workspace,
    connection: connector._id,
    externalId: payload.externalId,
  });
  if (!message) throw fail("Incoming message not found", 404);
  await inboundFile(connector.workspace, message.ticket, message._id, {
    content,
    filename: payload.filename || "whatsapp-file",
  });
}
export const channelAdmin = express.Router();
channelAdmin.use(authenticate);
channelAdmin.use("/:workspaceId", workspaceAccess);
channelAdmin.post(
  "/:workspaceId/channels",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        kind: Joi.string().valid("phone", "instagram", "messenger").required(),
        name: Joi.string().min(2).max(100).required(),
        token: Joi.string().max(2000).required(),
        secret: Joi.string().max(1000).required(),
        assetId: Joi.string()
          .pattern(/^[A-Za-z0-9]{5,100}$/)
          .required(),
        phoneNumber: Joi.string().pattern(/^\+[1-9]\d{7,14}$/),
        forwardTo: Joi.string().pattern(/^\+[1-9]\d{7,14}$/),
      }),
      req.body,
    );
    requireFeature(req.workspace, input.kind === "phone" ? "voice" : "social");
    if (
      input.kind === "phone" &&
      (!/^AC[a-f0-9]{32}$/i.test(input.assetId) ||
        !input.phoneNumber ||
        !input.forwardTo)
    )
      throw fail(
        "Twilio Account SID, owned phone number and agent destination are required",
      );
    if (input.kind === "phone" && input.phoneNumber === input.forwardTo)
      throw fail("Agent destination must differ from the owned phone number");
    const verify = crypto.randomBytes(24).toString("hex"),
      connector = await Connector.create({
        workspace: req.workspace._id,
        kind: input.kind,
        name: input.name,
        secret: encrypt(input.secret),
        token: encrypt(input.token),
        verifyTokenHash: digest(verify),
        config: {
          assetId: input.assetId,
          phoneNumber: input.phoneNumber,
          forwardTo: input.forwardTo,
        },
      });
    res.status(201).json({
      id: connector._id,
      verifyToken: verify,
      webhookPath:
        input.kind === "phone"
          ? `/api/voice/${connector._id}`
          : `/api/social/${connector._id}`,
    });
  }),
);
channelAdmin.post(
  "/:workspaceId/tickets/:ticketId/call",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "voice");
    const ticket = await ticketAccess(req, req.params.ticketId);
    if (ticket.guest && !ticket.guestVerified)
      throw fail("Verify guest identity before calling", 409);
    const contact = await Contact.findById(ticket.contact);
    const phone = "+" + String(contact.phone || "").replace(/\D/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw fail("Set a valid customer phone number first");
    const connector = await Connector.findOne({
      workspace: req.workspace._id,
      kind: "phone",
      enabled: true,
    }).select("+token");
    if (!connector) throw fail("Phone provider not connected", 503);
    const response = new twilio.twiml.VoiceResponse();
    response.dial(connector.config.forwardTo);
    const client = twilio(connector.config.assetId, decrypt(connector.token)),
      call = await client.calls.create({
        from: connector.config.phoneNumber,
        to: phone,
        twiml: response.toString(),
      });
    await withActor(req, async (session, w) => {
      await addMessage(
        w,
        ticket,
        {
          text: "Outbound phone call initiated with the connected provider.",
          internal: true,
        },
        req.user._id,
        "agent",
        session,
      );
      await audit(w._id, req.user._id, "phone.outbound", ticket._id, session, {
        callId: call.sid,
      });
    });
    res.json({ callId: call.sid, status: call.status });
  }),
);
channelAdmin.post(
  "/:workspaceId/tickets/:ticketId/channel-identity",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        connectorId: Joi.string().hex().length(24).required(),
        externalCustomer: Joi.string()
          .pattern(/^\d{8,30}$/)
          .required(),
        identityVerified: Joi.boolean().valid(true).required(),
      }),
      req.body,
    );
    await withActor(req, async (session, w) => {
      const ticket = await ticketAccess(req, req.params.ticketId, session);
      if (ticket.guest && !ticket.guestVerified)
        throw fail("Verify the customer email first", 409);
      const connector = await Connector.findOne({
        _id: objectId(input.connectorId),
        workspace: w._id,
        kind: { $in: ["whatsapp", "phone", "instagram", "messenger"] },
      }).session(session);
      if (!connector) throw fail("Connection not found", 404);
      const existing = await ChannelIdentity.findOne({
        workspace: w._id,
        connector: connector._id,
        externalCustomer: input.externalCustomer,
      }).session(session);
      if (existing && String(existing.contact) !== String(ticket.contact))
        throw fail("Identity is already linked to another customer", 409);
      await ChannelIdentity.updateOne(
        {
          workspace: w._id,
          connector: connector._id,
          externalCustomer: input.externalCustomer,
        },
        { $setOnInsert: { contact: ticket.contact, verifiedBy: req.user._id } },
        { upsert: true, session },
      );
      await Ticket.updateMany(
        {
          workspace: w._id,
          connection: connector._id,
          externalThread: input.externalCustomer,
        },
        { $set: { contact: ticket.contact }, $inc: { version: 1 } },
        { session },
      );
      await audit(
        w._id,
        req.user._id,
        "channel.identity-linked",
        ticket._id,
        session,
        { connector: String(connector._id) },
      );
    });
    res.json({ linked: true });
  }),
);
channelAdmin.post(
  "/:workspaceId/tickets/:ticketId/whatsapp",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "channels");
    const input = validate(
        Joi.object({
          template: Joi.object({
            name: Joi.string()
              .pattern(/^[a-z0-9_]{1,512}$/)
              .required(),
            language: Joi.string()
              .pattern(/^[a-z]{2,3}(_[A-Z]{2})?$/)
              .required(),
            parameters: Joi.array()
              .items(Joi.string().max(1000))
              .max(10)
              .default([]),
          }),
          attachmentId: Joi.string().hex().length(24),
          caption: Joi.string().max(1000).default(""),
        }).xor("template", "attachmentId"),
        req.body,
      ),
      ticket = await ticketAccess(req, req.params.ticketId),
      connector = await Connector.findOne({
        _id: ticket.connection,
        workspace: req.workspace._id,
        kind: "whatsapp",
        enabled: true,
      }).select("+token");
    if (!connector)
      throw fail("This ticket is not a WhatsApp conversation", 409);
    let mediaId, mime, name;
    if (input.attachmentId) {
      const file = await Attachment.findOne({
        _id: objectId(input.attachmentId),
        workspace: req.workspace._id,
        ticket: ticket._id,
        internal: false,
      }).select("+storageKey");
      if (!file) throw fail("Public scanned attachment not found", 404);
      const content = await fs.readFile(
          path.join(
            path.resolve(process.env.PRIVATE_UPLOAD_DIR || "./private-uploads"),
            file.storageKey,
          ),
        ),
        form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("file", new Blob([content], { type: file.mime }), file.name);
      const result = await fetch(
        `https://graph.facebook.com/${graph()}/${connector.config.phoneNumberId}/media`,
        {
          method: "POST",
          headers: { Authorization: "Bearer " + decrypt(connector.token) },
          body: form,
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!result.ok) throw fail("WhatsApp media upload failed", 502);
      mediaId = (await result.json()).id;
      if (!/^\d+$/.test(mediaId || ""))
        throw fail("Invalid media response", 502);
      mime = file.mime;
      name = file.name;
    }
    await withActor(req, async (session, w) => {
      const fresh = await ticketAccess(req, ticket._id, session),
        message = await addMessage(
          w,
          fresh,
          {
            text: input.template
              ? `Template: ${input.template.name}`
              : input.caption || "Attachment",
            attachments: input.attachmentId
              ? [objectId(input.attachmentId)]
              : [],
          },
          req.user._id,
          "agent",
          session,
        );
      await Job.updateOne(
        { key: `reply:${message._id}`, workspace: w._id },
        {
          $set: {
            kind: "whatsapp.structured",
            "payload.template": input.template,
            "payload.mediaId": mediaId,
            "payload.mime": mime,
            "payload.filename": name,
            "payload.caption": input.caption,
          },
        },
        { session },
      );
    });
    res.status(202).json({ queued: true });
  }),
);
export const voiceRoutes = express.Router();
voiceRoutes.post(
  "/:id",
  express.urlencoded({ extended: false, limit: "32kb" }),
  wrap(async (req, res) => {
    const connector = await Connector.findOne({
      _id: objectId(req.params.id),
      kind: "phone",
      enabled: true,
    }).select("+token");
    if (!connector) throw fail("Phone connection not found", 404);
    const workspace = await Workspace.findById(connector.workspace);
    requireFeature(workspace, "voice");
    const url = new URL(
      req.originalUrl,
      process.env.BACKEND_URL || "http://localhost:5000",
    ).href;
    if (
      !twilio.validateRequest(
        decrypt(connector.token),
        req.get("X-Twilio-Signature") || "",
        url,
        req.body,
      ) ||
      req.body.AccountSid !== connector.config.assetId ||
      req.body.To !== connector.config.phoneNumber
    )
      throw fail("Invalid voice signature", 401);
    const phone = String(req.body.From || "").replace(/\D/g, "");
    if (
      !/^\d{8,15}$/.test(phone) ||
      !/^CA[a-f0-9]{32}$/i.test(req.body.CallSid || "")
    )
      throw fail("Invalid call payload");
    await receive(connector, {
      messageId: req.body.CallSid,
      threadId: phone,
      email: `phone-${phone}@phone.invalid`,
      phone,
      subject: "Phone support request",
      description: "Incoming phone call received.",
    });
    const response = new twilio.twiml.VoiceResponse();
    response.say("Connecting you to the support team.");
    response.dial(connector.config.forwardTo);
    res.type("text/xml").send(response.toString());
  }),
);
export const socialRoutes = express.Router();
socialRoutes.get(
  "/:id",
  wrap(async (req, res) => {
    const c = await Connector.findOne({
      _id: objectId(req.params.id),
      kind: { $in: ["instagram", "messenger"] },
      enabled: true,
    }).select("+verifyTokenHash");
    if (
      !c ||
      req.query["hub.mode"] !== "subscribe" ||
      digest(String(req.query["hub.verify_token"] || "")) !== c.verifyTokenHash
    )
      throw fail("Invalid verification token", 403);
    res.type("text/plain").send(String(req.query["hub.challenge"] || ""));
  }),
);
socialRoutes.post(
  "/:id",
  express.raw({ type: "application/json", limit: "1mb" }),
  wrap(async (req, res) => {
    const c = await Connector.findOne({
      _id: objectId(req.params.id),
      kind: { $in: ["instagram", "messenger"] },
      enabled: true,
    }).select("+secret");
    if (
      !c ||
      !signatureOK(decrypt(c.secret), req.body, req.get("X-Hub-Signature-256"))
    )
      throw fail("Invalid social signature", 401);
    const w = await Workspace.findById(c.workspace);
    requireFeature(w, "social");
    const payload = JSON.parse(req.body.toString());
    for (const entry of payload.entry || []) {
      if (String(entry.id) !== c.config.assetId) continue;
      for (const event of entry.messaging || []) {
        if (
          event.message?.is_echo ||
          !event.message?.mid ||
          !/^\d{8,30}$/.test(String(event.sender?.id))
        )
          continue;
        const sender = String(event.sender.id);
        await receive(c, {
          messageId: String(event.message.mid).slice(0, 300),
          threadId: sender,
          email: `${c.kind}-${sender}@social.invalid`,
          subject: `${c.kind} support request`,
          description: String(
            event.message.text ||
              "(Non-text message: view it in the provider inbox)",
          ).slice(0, 10000),
        });
      }
    }
    res.json({ received: true });
  }),
);

import express from "express";
import Joi from "joi";
import crypto from "node:crypto";
import twilio from "twilio";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  Connector,
  Workspace,
  Membership,
  CustomRole,
  Contact,
  AuthFlow,
  VoiceCall,
  VoiceUtterance,
} from "./models.js";
import { encrypt, decrypt } from "./connectors.js";
import {
  workspaceAccess,
  permit,
  ticketAccess,
  objectId,
  withActor,
  inWorkspace,
  audit,
} from "./access.js";
import { requireFeature, seatAllowed } from "./entitlements.js";
import { digest } from "./tickets.js";
import { validate, fail } from "./validation.js";
import { voiceDeskPublic, releaseDesk } from "./voiceDesk.js";
const e164 = Joi.string().pattern(/^\+[1-9]\d{7,14}$/);
const root = () =>
  new URL(process.env.BACKEND_URL || "http://localhost:5000").origin;
export function startTranscription(response, c) {
  if (c.config.voice?.liveTranscription)
    response.start().transcription({
      statusCallbackUrl: `${root()}/api/voice-plus/${c._id}/live-transcription`,
      track: "both_tracks",
      languageCode: c.config.voice.languageCode || "en-US",
      partialResults: false,
    });
}
export function inboundTwiML(c, digits, browser) {
  const cfg = c.config.voice || {},
    response = new twilio.twiml.VoiceResponse();
  if (cfg.recordCalls || cfg.liveTranscription)
    response.say(cfg.recordingNotice);
  if (cfg.ivr?.routes?.length && !digits) {
    response
      .gather({
        numDigits: 1,
        timeout: 8,
        method: "POST",
        action: `${root()}/api/voice/${c._id}`,
      })
      .say(cfg.ivr.greeting);
    response.redirect(
      { method: "POST" },
      `${root()}/api/voice-plus/${c._id}/voicemail`,
    );
  } else {
    const route = cfg.ivr?.routes?.find((r) => r.digit === digits);
    if (digits && !route) {
      response.say("Invalid selection. Please try again.");
      response.redirect({ method: "POST" }, `${root()}/api/voice/${c._id}`);
    } else {
      startTranscription(response, c);
      if (browser) {
        const client = response
          .dial({
            timeout: 25,
            action: `${root()}/api/voice-plus/${c._id}/browser-fallback`,
            ...(cfg.recordCalls
              ? {
                  record: "record-from-answer-dual",
                  recordingStatusCallback: `${root()}/api/voice-plus/${c._id}/recording`,
                }
              : {}),
          })
          .client({
            statusCallback: `${root()}/api/voice-plus/${c._id}/desk-status?call=${browser.callSid}`,
            statusCallbackEvent: ["completed"],
          });
        client.identity(browser.identity);
        client.parameter({ name: "ticketId", value: String(browser.ticket) });
      } else
        response.dial(
          {
            ...(cfg.recordCalls
              ? {
                  record: "record-from-answer-dual",
                  recordingStatusCallback: `${root()}/api/voice-plus/${c._id}/recording`,
                  recordingStatusCallbackMethod: "POST",
                }
              : {}),
            callerId: c.config.phoneNumber,
            timeout: 25,
            action: `${root()}/api/voice-plus/${c._id}/voicemail`,
          },
          route?.destination || c.config.forwardTo,
        );
    }
  }
  return response.toString();
}
export const voiceAdmin = express.Router();
voiceAdmin.use(authenticate);
voiceAdmin.use("/:workspaceId", workspaceAccess);
voiceAdmin.put(
  "/:workspaceId/connectors/:connectorId/voice",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "voice");
    const cfg = validate(
      Joi.object({
        apiKeySid: Joi.string().pattern(/^SK[a-f0-9]{32}$/i),
        apiKeySecret: Joi.string().max(1000),
        appSid: Joi.string().pattern(/^AP[a-f0-9]{32}$/i),
        browserInbound: Joi.boolean().default(false),
        liveTranscription: Joi.boolean().default(false),
        languageCode: Joi.string()
          .valid("en-US", "en-IN", "hi-IN")
          .default("en-US"),
        recordCalls: Joi.boolean().default(false),
        recordingNotice: Joi.string().max(500).allow("").default(""),
        ivr: Joi.object({
          greeting: Joi.string().min(3).max(1000).required(),
          routes: Joi.array()
            .items(
              Joi.object({
                digit: Joi.string()
                  .pattern(/^[0-9]$/)
                  .required(),
                label: Joi.string().max(60).required(),
                destination: e164.required(),
              }),
            )
            .min(1)
            .max(10)
            .unique("digit")
            .required(),
        }).allow(null),
      }).and("apiKeySid", "apiKeySecret", "appSid"),
      req.body,
    );
    if (
      (cfg.recordCalls || cfg.liveTranscription) &&
      cfg.recordingNotice.trim().length < 10
    )
      throw fail("A recording notice is required before enabling recording");
    await withActor(req, async (session, w) => {
      const c = await Connector.findOne({
        _id: objectId(req.params.connectorId),
        workspace: w._id,
        kind: "phone",
      }).session(session);
      if (!c) throw fail("Phone connector not found", 404);
      if (cfg.ivr?.routes.some((r) => r.destination === c.config.phoneNumber))
        throw fail("IVR cannot forward to its own number");
      c.config = {
        ...c.config,
        voice: {
          ...c.config.voice,
          ...cfg,
          ...(cfg.apiKeySecret
            ? { apiKeySecret: encrypt(cfg.apiKeySecret) }
            : {}),
        },
      };
      await c.save({ session });
      w.settings = { ...w.settings, browserPhoneEnabled: cfg.browserInbound };
      await w.save({ session });
      await audit(w._id, req.user._id, "voice.configured", c._id, session);
    });
    res.json({
      configured: true,
      dialCallback: `/api/voice-plus/${req.params.connectorId}/dial`,
    });
  }),
);
voiceAdmin.post(
  "/:workspaceId/tickets/:ticketId/voice-token",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "voice");
    const ticket = await ticketAccess(req, req.params.ticketId);
    if (ticket.guest && !ticket.guestVerified)
      throw fail("Verify customer identity first", 409);
    const contact = await Contact.findOne({
      _id: ticket.contact,
      workspace: req.workspace._id,
    });
    const phone = "+" + String(contact?.phone || "").replace(/\D/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
      throw fail("Set a valid customer phone first");
    const c = await Connector.findOne({
      workspace: req.workspace._id,
      kind: "phone",
      enabled: true,
    });
    const cfg = c?.config?.voice;
    if (!cfg?.apiKeySecret || !cfg.appSid)
      throw fail("Configure the Twilio Voice SDK application first", 503);
    const identity = "qf" + crypto.randomBytes(20).toString("hex");
    await withActor(req, (session, w) =>
      AuthFlow.create(
        [
          {
            hash: digest(identity),
            kind: "voice-grant",
            workspace: w._id,
            user: req.user._id,
            expiresAt: new Date(Date.now() + 600000),
            payload: {
              connector: String(c._id),
              ticket: String(ticket._id),
              phone,
              claims: req.authClaims,
            },
          },
        ],
        { session },
      ),
    );
    const Token = twilio.jwt.AccessToken,
      access = new Token(
        c.config.assetId,
        cfg.apiKeySid,
        decrypt(cfg.apiKeySecret),
        { identity, ttl: 600 },
      );
    access.addGrant(
      new Token.VoiceGrant({
        outgoingApplicationSid: cfg.appSid,
        incomingAllow: false,
      }),
    );
    res.json({ token: access.toJwt(), identity, phone });
  }),
);
voiceAdmin.get(
  "/:workspaceId/tickets/:ticketId/calls",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    res.json(
      await VoiceCall.find({ workspace: req.workspace._id, ticket: ticket._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    );
  }),
);
voiceAdmin.get(
  "/:workspaceId/tickets/:ticketId/calls/:callId/recording",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId),
      call = await VoiceCall.findOne({
        _id: objectId(req.params.callId),
        ticket: ticket._id,
        workspace: req.workspace._id,
      });
    if (!call?.recordingSid) throw fail("Recording not available", 404);
    const c = await Connector.findOne({
      _id: call.connector,
      workspace: req.workspace._id,
      enabled: true,
    }).select("+token");
    if (!c) throw fail("Connector disabled", 409);
    const cfg = c.config.voice;
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.config.assetId}/Recordings/${call.recordingSid}.mp3`,
      {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              cfg?.apiKeySecret
                ? cfg.apiKeySid + ":" + decrypt(cfg.apiKeySecret)
                : c.config.assetId + ":" + decrypt(c.token),
            ).toString("base64"),
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    const { boundedBody } = await import("./omnichannel.js");
    const data = await boundedBody(response, 25 * 1024 ** 2);
    res
      .set("Cache-Control", "no-store")
      .type("audio/mpeg")
      .attachment("support-call.mp3")
      .send(data);
  }),
);
export const voicePublic = express.Router();
voicePublic.use(express.urlencoded({ extended: false, limit: "64kb" }));
voicePublic.use(
  "/:id",
  wrap(async (req, res, next) => {
    const c = await Connector.findOne({
      _id: objectId(req.params.id),
      kind: "phone",
      enabled: true,
    }).select("+token");
    if (
      !c ||
      !twilio.validateRequest(
        decrypt(c.token),
        req.get("X-Twilio-Signature") || "",
        new URL(req.originalUrl, root()).href,
        req.body,
      ) ||
      req.body.AccountSid !== c.config.assetId
    )
      throw fail("Invalid voice callback", 401);
    const w = await Workspace.findById(c.workspace);
    requireFeature(w, "voice");
    req.voiceConnector = c;
    req.voiceWorkspace = w;
    next();
  }),
);
voicePublic.post(
  "/:id/dial",
  wrap(async (req, res) => {
    const c = req.voiceConnector,
      w = req.voiceWorkspace;
    const identity = String(req.body.From || "").replace(/^client:/, "");
    const flow = await AuthFlow.findOneAndDelete({
      hash: digest(identity),
      kind: "voice-grant",
      workspace: w._id,
      expiresAt: { $gt: new Date() },
      "payload.connector": String(c._id),
    });
    if (!flow) throw fail("Call grant expired or already used", 403);
    const member = await Membership.findOne({
      workspace: w._id,
      user: flow.user,
      active: true,
      role: { $in: ["owner", "admin", "agent"] },
    });
    if (!member || !(await seatAllowed(w, member)))
      throw fail("Staff access revoked", 403);
    if (
      member.customRole &&
      !(await CustomRole.exists({
        _id: member.customRole,
        workspace: w._id,
        permissions: "tickets.write",
      }))
    )
      throw fail("Calling permission revoked", 403);
    const { user } = await (
      await import("../models/User.js")
    ).findUserById(flow.user);
    if (!user || user.isActive === false) throw fail("Account disabled", 403);
    const { sessionAllowed } = await import("../services/tokenService.js");
    if (
      !flow.payload.claims ||
      (flow.payload.claims.exp &&
        flow.payload.claims.exp * 1000 <= Date.now()) ||
      !sessionAllowed(user, flow.payload.claims)
    )
      throw fail("Call authorization revoked", 403);
    const { assertMFA } = await import("./security.js");
    await assertMFA(user, flow.payload.claims);
    const request = { workspace: w, member, user };
    const ticket = await ticketAccess(request, flow.payload.ticket);
    if (!/^CA[a-f0-9]{32}$/i.test(req.body.CallSid || ""))
      throw fail("Invalid call ID");
    await inWorkspace(w._id, async (session, fresh) => {
      requireFeature(fresh, "voice");
      const current = await Membership.findOne({
        _id: member._id,
        workspace: fresh._id,
        active: true,
        role: { $in: ["owner", "admin", "agent"] },
      }).session(session);
      if (!current || !(await seatAllowed(fresh, current, session)))
        throw fail("Staff access revoked", 403);
      if (
        current.customRole &&
        !(await CustomRole.exists({
          _id: current.customRole,
          workspace: fresh._id,
          permissions: "tickets.write",
        }).session(session))
      )
        throw fail("Calling permission revoked", 403);
      await ticketAccess(
        { workspace: fresh, member: current, user },
        ticket._id,
        session,
      );
      if (
        await VoiceCall.exists({
          workspace: fresh._id,
          deskMember: current._id,
          status: { $in: ["ringing", "initiated", "in-progress"] },
          createdAt: { $gt: new Date(Date.now() - 4 * 3600000) },
        }).session(session)
      )
        throw fail("An agent call is already active", 409);
      await VoiceCall.create(
        [
          {
            workspace: fresh._id,
            ticket: ticket._id,
            connector: c._id,
            callSid: req.body.CallSid,
            direction: "outbound-browser",
            status: "initiated",
            recordingConsent: !!c.config.voice?.recordCalls,
            transcriptionEnabled: !!c.config.voice?.liveTranscription,
            deskMember: current._id,
          },
        ],
        { session },
      );
    });
    const response = new twilio.twiml.VoiceResponse();
    if (c.config.voice?.recordCalls || c.config.voice?.liveTranscription)
      response.say(c.config.voice.recordingNotice);
    startTranscription(response, c);
    response
      .dial({
        callerId: c.config.phoneNumber,
        action: `${root()}/api/voice-plus/${c._id}/call-ended`,
        ...(c.config.voice?.recordCalls
          ? {
              record: "record-from-answer-dual",
              recordingStatusCallback: `${root()}/api/voice-plus/${c._id}/recording`,
            }
          : {}),
      })
      .number(
        c.config.voice?.recordCalls || c.config.voice?.liveTranscription
          ? { url: `${root()}/api/voice-plus/${c._id}/notice`, method: "POST" }
          : {},
        flow.payload.phone,
      );
    res.type("text/xml").send(response.toString());
  }),
);
voicePublic.post(
  "/:id/notice",
  wrap(async (req, res) => {
    const response = new twilio.twiml.VoiceResponse();
    if (
      req.voiceConnector.config.voice?.recordCalls ||
      req.voiceConnector.config.voice?.liveTranscription
    )
      response.say(req.voiceConnector.config.voice.recordingNotice);
    res.type("text/xml").send(response.toString());
  }),
);
voicePublic.post(
  "/:id/recording",
  wrap(async (req, res) => {
    if (!/^RE[a-f0-9]{32}$/i.test(req.body.RecordingSid || ""))
      throw fail("Invalid recording ID");
    await VoiceCall.updateOne(
      {
        workspace: req.voiceWorkspace._id,
        connector: req.voiceConnector._id,
        callSid: req.body.CallSid,
        recordingConsent: true,
      },
      {
        $set: {
          recordingSid: req.body.RecordingSid,
          recordingDuration: Math.max(
            0,
            Math.min(86400, Number(req.body.RecordingDuration) || 0),
          ),
          status: "recorded",
        },
      },
    );
    res.sendStatus(204);
  }),
);
voicePublic.post(
  "/:id/voicemail",
  wrap(async (req, res) => {
    const response = new twilio.twiml.VoiceResponse(),
      c = req.voiceConnector;
    await releaseDesk(
      req.voiceWorkspace._id,
      req.body.CallSid,
      req.body.DialCallStatus || "no-answer",
    );
    if (["completed", "answered"].includes(req.body.DialCallStatus)) {
      response.hangup();
    } else if (c.config.voice?.recordCalls) {
      response.say(
        c.config.voice.recordingNotice +
          " Please leave a message after the tone.",
      );
      response.record({
        maxLength: 120,
        transcribe: true,
        transcribeCallback: `${root()}/api/voice-plus/${c._id}/transcription`,
        recordingStatusCallback: `${root()}/api/voice-plus/${c._id}/recording`,
      });
    } else {
      response.say("No agent is available. Please contact the help centre.");
      response.hangup();
    }
    res.type("text/xml").send(response.toString());
  }),
);
voicePublic.post(
  "/:id/transcription",
  wrap(async (req, res) => {
    await VoiceCall.updateOne(
      {
        workspace: req.voiceWorkspace._id,
        connector: req.voiceConnector._id,
        callSid: req.body.CallSid,
        recordingConsent: true,
      },
      {
        $set: {
          transcription: String(req.body.TranscriptionText || "").slice(
            0,
            10000,
          ),
        },
      },
    );
    res.sendStatus(204);
  }),
);

voicePublic.post(
  "/:id/live-transcription",
  wrap(async (req, res) => {
    const b = req.body;
    if (b.TranscriptionEvent !== "transcription-content" || b.Final !== "true")
      return res.sendStatus(204);
    if (
      !/^GT[a-f0-9]{32}$/i.test(b.TranscriptionSid || "") ||
      !/^\d{1,9}$/.test(b.SequenceId || "") ||
      !["inbound_track", "outbound_track"].includes(b.Track)
    )
      throw fail("Invalid transcription callback");
    const call = await VoiceCall.findOne({
      workspace: req.voiceWorkspace._id,
      connector: req.voiceConnector._id,
      callSid: b.CallSid,
      transcriptionEnabled: true,
    });
    if (!call) return res.sendStatus(204);
    let data;
    try {
      data = JSON.parse(b.TranscriptionData);
    } catch {
      throw fail("Invalid transcription data");
    }
    if (typeof data.transcript !== "string" || data.transcript.length > 10000)
      throw fail("Invalid transcript");
    await VoiceUtterance.updateOne(
      {
        workspace: call.workspace,
        call: call._id,
        transcriptionSid: b.TranscriptionSid,
        track: b.Track,
        sequence: Number(b.SequenceId),
      },
      {
        $setOnInsert: {
          text: data.transcript,
          confidence:
            typeof data.confidence === "number" ? data.confidence : undefined,
          spokenAt: new Date(),
        },
      },
      { upsert: true },
    );
    res.sendStatus(204);
  }),
);
voicePublic.use("/:id", voiceDeskPublic);
voiceAdmin.get(
  "/:workspaceId/tickets/:ticketId/calls/:callId/transcript",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    const call = await VoiceCall.findOne({
      _id: objectId(req.params.callId),
      ticket: ticket._id,
      workspace: req.workspace._id,
    });
    if (!call) throw fail("Call not found", 404);
    const { after } = validate(
      Joi.object({ after: Joi.string().hex().length(24) }),
      req.query,
    );
    res.set("Cache-Control", "no-store").json(
      await VoiceUtterance.find({
        workspace: req.workspace._id,
        call: call._id,
        ...(after ? { _id: { $gt: objectId(after) } } : {}),
      })
        .sort({ _id: 1 })
        .limit(200)
        .lean(),
    );
  }),
);

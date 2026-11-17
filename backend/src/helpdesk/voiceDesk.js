import express from "express";
import crypto from "node:crypto";
import Joi from "joi";
import twilio from "twilio";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  VoiceDesk,
  VoiceCall,
  Membership,
  Connector,
  CustomRole,
  Ticket,
} from "./models.js";
import {
  workspaceAccess,
  permit,
  inWorkspace,
  withActor,
  audit,
} from "./access.js";
import { requireFeature, seatAllowed } from "./entitlements.js";
import { decrypt } from "./connectors.js";
import { digest } from "./tickets.js";
import { validate, fail } from "./validation.js";
import { findUserById } from "../models/User.js";
import { sessionAllowed } from "../services/tokenService.js";
const root = () =>
  new URL(process.env.BACKEND_URL || "http://localhost:5000").origin;
export const deskIdentity = (workspace, member) =>
  `desk_${workspace}_${member}`;
export const voiceDeskAdmin = express.Router();
voiceDeskAdmin.use(authenticate);
voiceDeskAdmin.use("/:workspaceId", workspaceAccess);
voiceDeskAdmin.post(
  "/:workspaceId/voice/desk",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "voice");
    const { sessionId } = validate(
      Joi.object({ sessionId: Joi.string().hex().length(64) }),
      req.body,
    );
    const c = await Connector.findOne({
      workspace: req.workspace._id,
      kind: "phone",
      enabled: true,
      "config.voice.browserInbound": true,
    });
    if (!c?.config.voice.apiKeySecret)
      throw fail(
        "Enable browser inbound calling on a configured phone connection first",
        503,
      );
    const lease = sessionId || crypto.randomBytes(32).toString("hex");
    const identity = deskIdentity(req.workspace._id, req.member._id);
    await withActor(req, async (session, w) => {
      const old = await VoiceDesk.findOne({
        workspace: w._id,
        member: req.member._id,
      })
        .select("+sessionHash")
        .session(session);
      if (
        old &&
        old.expiresAt > new Date() &&
        old.sessionHash !== digest(lease)
      )
        throw fail(
          "Another browser session is already receiving calls. Disconnect it first or wait for its availability lease to expire.",
          409,
        );
      await VoiceDesk.findOneAndUpdate(
        { workspace: w._id, member: req.member._id },
        {
          $set: {
            connector: c._id,
            identity,
            sessionHash: digest(lease),
            claims: req.authClaims,
            expiresAt: new Date(Date.now() + 90000),
          },
        },
        { upsert: true, session },
      );
    });
    const Token = twilio.jwt.AccessToken,
      access = new Token(
        c.config.assetId,
        c.config.voice.apiKeySid,
        decrypt(c.config.voice.apiKeySecret),
        { identity, ttl: 600 },
      );
    // Incoming desk tokens cannot dial arbitrary destinations through the TwiML app.
    access.addGrant(new Token.VoiceGrant({ incomingAllow: true }));
    res.json({
      token: access.toJwt(),
      sessionId: lease,
      identity,
      expiresIn: 600,
    });
  }),
);
voiceDeskAdmin.delete(
  "/:workspaceId/voice/desk",
  permit("owner", "admin", "agent"),
  wrap(async (req, res) => {
    const { sessionId } = validate(
      Joi.object({ sessionId: Joi.string().hex().length(64).required() }),
      req.body,
    );
    await VoiceDesk.deleteOne({
      workspace: req.workspace._id,
      member: req.member._id,
      sessionHash: digest(sessionId),
    });
    res.sendStatus(204);
  }),
);
export async function reserveBrowser(
  c,
  ticketId,
  callSid,
  group,
  fallbackNumber,
) {
  if (!c.config.voice?.browserInbound) return null;
  return inWorkspace(c.workspace, async (session, w) => {
    requireFeature(w, "voice");
    const call = await VoiceCall.findOne({
      workspace: w._id,
      connector: c._id,
      callSid,
    }).session(session);
    if (!call) return null;
    if (call.deskMember) {
      const claimed = await VoiceDesk.findOne({
        workspace: w._id,
        member: call.deskMember,
        currentCall: callSid,
        expiresAt: { $gt: new Date() },
      }).session(session);
      return claimed
        ? { identity: claimed.identity, member: claimed.member }
        : null;
    }
    const ticket = await Ticket.findOne({
      _id: ticketId,
      workspace: w._id,
    }).session(session);
    if (!ticket) return null;
    const desks = await VoiceDesk.find({
      workspace: w._id,
      connector: c._id,
      expiresAt: { $gt: new Date() },
      $or: [{ currentCall: null }, { callUntil: { $lt: new Date() } }],
    })
      .select("+claims")
      .sort({ updatedAt: 1 })
      .limit(100)
      .session(session);
    desks.sort(
      (a, b) =>
        (String(a.member) === String(ticket.assignedTo) ? -1 : 0) -
        (String(b.member) === String(ticket.assignedTo) ? -1 : 0),
    );
    for (const desk of desks) {
      const member = await Membership.findOne({
        _id: desk.member,
        workspace: w._id,
        active: true,
        online: true,
        role: { $in: ["owner", "admin", "agent"] },
        ...(group ? { $or: [{ groups: group }, { scimGroups: group }] } : {}),
      }).session(session);
      if (!member || !(await seatAllowed(w, member, session))) continue;
      if (
        member.customRole &&
        !(await CustomRole.exists({
          _id: member.customRole,
          workspace: w._id,
          permissions: { $all: ["tickets.read", "tickets.write"] },
        }).session(session))
      )
        continue;
      const { user } = await findUserById(member.user);
      if (
        !desk.claims ||
        (desk.claims.exp && desk.claims.exp * 1000 <= Date.now()) ||
        !sessionAllowed(user, desk.claims)
      )
        continue;
      try {
        const { assertMFA } = await import("./security.js");
        await assertMFA(user, desk.claims);
      } catch {
        continue;
      }
      const active = await VoiceCall.exists({
        workspace: w._id,
        deskMember: member._id,
        status: { $in: ["ringing", "initiated", "in-progress"] },
        createdAt: { $gt: new Date(Date.now() - 4 * 3600000) },
      }).session(session);
      if (active) continue;
      desk.currentCall = callSid;
      desk.callUntil = new Date(Date.now() + 4 * 3600000);
      await desk.save({ session });
      call.fallbackNumber = fallbackNumber || c.config.forwardTo;
      call.deskMember = member._id;
      call.status = "ringing";
      await call.save({ session });
      ticket.assignedTo = member._id;
      ticket.version++;
      await ticket.save({ session });
      await audit(w._id, "voice", "phone.browser-routed", ticket._id, session, {
        member: String(member._id),
      });
      return { identity: desk.identity, member: member._id };
    }
    return null;
  });
}
export async function releaseDesk(workspace, callSid, status = "completed") {
  await VoiceDesk.updateMany(
    { workspace, currentCall: callSid },
    { $unset: { currentCall: 1, callUntil: 1 } },
  );
  await VoiceCall.updateOne({ workspace, callSid }, { $set: { status } });
}
// Mounted only after the shared Twilio signature/account/plan middleware.
export const voiceDeskPublic = express.Router();
voiceDeskPublic.post(
  "/desk-status",
  wrap(async (req, res) => {
    const parent = String(req.query.call || req.body.ParentCallSid || "");
    if (!/^CA[a-f0-9]{32}$/i.test(parent)) throw fail("Invalid parent call");
    if (
      ["completed", "busy", "failed", "no-answer", "canceled"].includes(
        req.body.CallStatus,
      )
    )
      await releaseDesk(req.voiceWorkspace._id, parent, req.body.CallStatus);
    res.sendStatus(204);
  }),
);
voiceDeskPublic.post(
  "/call-ended",
  wrap(async (req, res) => {
    if (!/^CA[a-f0-9]{32}$/i.test(req.body.CallSid || ""))
      throw fail("Invalid call ID");
    await releaseDesk(
      req.voiceWorkspace._id,
      req.body.CallSid,
      req.body.DialCallStatus || "completed",
    );
    const r = new twilio.twiml.VoiceResponse();
    r.hangup();
    res.type("text/xml").send(r.toString());
  }),
);
voiceDeskPublic.post(
  "/browser-fallback",
  wrap(async (req, res) => {
    const c = req.voiceConnector,
      parent = String(req.body.CallSid || "");
    if (!/^CA[a-f0-9]{32}$/i.test(parent)) throw fail("Invalid call ID");
    await releaseDesk(
      req.voiceWorkspace._id,
      parent,
      req.body.DialCallStatus || "completed",
    );
    const r = new twilio.twiml.VoiceResponse();
    if (["completed", "answered"].includes(req.body.DialCallStatus)) r.hangup();
    else {
      const call = await VoiceCall.findOne({
        workspace: req.voiceWorkspace._id,
        connector: c._id,
        callSid: parent,
      });
      r.dial(
        {
          callerId: c.config.phoneNumber,
          timeout: 25,
          action: `${root()}/api/voice-plus/${c._id}/voicemail`,
          ...(c.config.voice?.recordCalls
            ? {
                record: "record-from-answer-dual",
                recordingStatusCallback: `${root()}/api/voice-plus/${c._id}/recording`,
              }
            : {}),
        },
        call?.fallbackNumber || c.config.forwardTo,
      );
    }
    res.type("text/xml").send(r.toString());
  }),
);

import crypto from "node:crypto";
import express from "express";
import Joi from "joi";
import { AuthFlow, Connector, Workspace, Membership } from "./models.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  inWorkspace,
  audit,
} from "./access.js";
import { requireFeature } from "./entitlements.js";
import { encrypt } from "./connectors.js";
import { digest } from "./tickets.js";
import { validate, fail } from "./validation.js";
const callback = () =>
  new URL(
    "/api/mail-oauth/callback",
    process.env.BACKEND_URL || "http://localhost:5000",
  ).href;
const cookie = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 600000,
});
const config = (provider) => {
  const prefix = provider === "google" ? "GOOGLE_MAIL" : "MICROSOFT_MAIL";
  const id = process.env[prefix + "_CLIENT_ID"],
    secret = process.env[prefix + "_CLIENT_SECRET"];
  if (!id || !secret) throw fail("Mailbox OAuth app is not configured", 503);
  return {
    id,
    secret,
    auth:
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token:
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:
      provider === "google"
        ? "https://mail.google.com/"
        : "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access",
  };
};
export const mailOAuthAdmin = express.Router();
mailOAuthAdmin.use(authenticate);
mailOAuthAdmin.use("/:workspaceId", workspaceAccess);
mailOAuthAdmin.post(
  "/:workspaceId/connectors/:connectorId/oauth",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "imap");
    const input = validate(
      Joi.object({
        provider: Joi.string().valid("google", "microsoft").required(),
        user: Joi.string().email().required(),
      }),
      req.body,
    );
    const cfg = config(input.provider),
      state = crypto.randomBytes(32).toString("hex"),
      browser = crypto.randomBytes(32).toString("hex"),
      verifier = crypto.randomBytes(32).toString("base64url");
    await withActor(req, async (session, w) => {
      if (
        !(await Connector.exists({
          _id: objectId(req.params.connectorId),
          workspace: w._id,
          kind: "email",
        }).session(session))
      )
        throw fail("Email connector not found", 404);
      await AuthFlow.create(
        [
          {
            hash: digest(state),
            kind: "mail-oauth",
            workspace: w._id,
            user: req.user._id,
            expiresAt: new Date(Date.now() + 600000),
            payload: {
              ...input,
              connector: req.params.connectorId,
              browser: digest(browser),
              verifier: encrypt(verifier),
            },
          },
        ],
        { session },
      );
    });
    res.cookie("qf_mail_oauth", browser, cookie());
    const url = new URL(cfg.auth);
    url.search = new URLSearchParams({
      client_id: cfg.id,
      redirect_uri: callback(),
      response_type: "code",
      scope: cfg.scope,
      state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    res.json({ url: url.href });
  }),
);
export const mailOAuthPublic = express.Router();
mailOAuthPublic.get(
  "/callback",
  wrap(async (req, res) => {
    const flow = await AuthFlow.findOneAndDelete({
      hash: digest(String(req.query.state || "")),
      kind: "mail-oauth",
      expiresAt: { $gt: new Date() },
      "payload.browser": digest(req.cookies?.qf_mail_oauth || ""),
    });
    if (!flow || typeof req.query.code !== "string")
      throw fail("Mailbox OAuth session expired or denied", 401);
    const { decrypt } = await import("./connectors.js");
    const cfg = config(flow.payload.provider);
    const response = await fetch(cfg.token, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: callback(),
        client_id: cfg.id,
        client_secret: cfg.secret,
        code_verifier: decrypt(flow.payload.verifier),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw fail("Mailbox authorization failed", 502);
    const tokens = await response.json();
    if (
      !tokens.refresh_token ||
      !tokens.access_token ||
      !Number.isFinite(tokens.expires_in)
    )
      throw fail("Offline mailbox access was not granted", 409);
    await inWorkspace(flow.workspace, async (session, workspace) => {
      requireFeature(workspace, "imap");
      if (
        !(await Membership.exists({
          workspace: workspace._id,
          user: flow.user,
          active: true,
          role: { $in: ["owner", "admin"] },
          customRole: null,
        }).session(session))
      )
        throw fail("Unrestricted administrator membership required", 403);
      const c = await Connector.findOne({
        _id: objectId(flow.payload.connector),
        workspace: workspace._id,
        kind: "email",
      }).session(session);
      if (!c) throw fail("Connector removed", 404);
      c.config = {
        ...c.config,
        imap: {
          host:
            flow.payload.provider === "google"
              ? "imap.gmail.com"
              : "outlook.office365.com",
          user: flow.payload.user,
          mailbox: "INBOX",
        },
        oauth: {
          provider: flow.payload.provider,
          refreshToken: encrypt(tokens.refresh_token),
          accessToken: encrypt(tokens.access_token),
          expiresAt: Date.now() + tokens.expires_in * 1000,
        },
      };
      c.cursor = undefined;
      c.lastSyncAt = undefined;
      await c.save({ session });
      await audit(
        workspace._id,
        flow.user,
        "mailbox.oauth-connected",
        c._id,
        session,
      );
    });
    res.clearCookie("qf_mail_oauth", cookie());
    res.redirect(
      new URL(
        "/workspaces",
        process.env.FRONTEND_URL || "http://localhost:5173",
      ).href,
    );
  }),
);

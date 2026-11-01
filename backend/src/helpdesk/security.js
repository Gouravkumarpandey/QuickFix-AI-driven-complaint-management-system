import crypto from "node:crypto";
import express from "express";
import Joi from "joi";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import rateLimit from "express-rate-limit";
import * as oidc from "openid-client";
import { authenticate } from "../middleware/auth.js";
import { jwtSecret } from "../services/tokenService.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  SecurityProfile,
  AuthFlow,
  SSOIdentity,
  Workspace,
  Membership,
  CustomRole,
} from "./models.js";
import { encrypt, decrypt } from "./connectors.js";
import { digest } from "./tickets.js";
import {
  workspaceAccess,
  permit,
  withActor,
  objectId,
  audit,
} from "./access.js";
import { requireFeature } from "./entitlements.js";
import { validate, fail } from "./validation.js";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(value) {
  let bits = 0,
    n = 0,
    out = [];
  for (const ch of value) {
    const index = alphabet.indexOf(ch);
    if (index < 0) throw fail("Invalid authenticator secret");
    n = (n << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((n >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, counter = Math.floor(Date.now() / 30000)) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", decode32(secret)).update(bytes).digest(),
    offset = h[19] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function matchTotp(secret, code, last = -1, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const c of [current, current - 1, current + 1])
    if (
      c > last &&
      crypto.timingSafeEqual(Buffer.from(totp(secret, c)), Buffer.from(code))
    )
      return c;
  return null;
}
export async function assertMFA(user, claims) {
  const profile = await SecurityProfile.findOne({
    user: user._id,
    enabled: true,
  }).lean();
  if (
    profile &&
    (!claims.mfaAt ||
      claims.mfaAt < Date.now() - 12 * 3600000 ||
      claims.mfaVersion !== profile.version)
  )
    throw fail(
      "MFA_REQUIRED: Verify your authenticator or a recovery code.",
      403,
    );
}
function sessionToken(user, profile) {
  return jwt.sign(
    {
      id: String(user._id),
      tokenType: "access",
      issuedAt: Date.now(),
      mfaAt: Date.now(),
      mfaVersion: profile.version,
    },
    jwtSecret(),
    { expiresIn: "12h" },
  );
}
const codeSchema = Joi.object({
  code: Joi.string().trim().min(6).max(80).required(),
});
export const securityRoutes = express.Router();
securityRoutes.use(authenticate);
securityRoutes.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 30,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
securityRoutes.get(
  "/mfa",
  wrap(async (req, res) => {
    const p = await SecurityProfile.findOne({ user: req.user._id });
    res.json({
      enabled: !!p?.enabled,
      verified:
        !!req.authClaims?.mfaAt &&
        req.authClaims.mfaAt > Date.now() - 12 * 3600000 &&
        req.authClaims.mfaVersion === p?.version,
      configured: !!process.env.INTEGRATION_ENCRYPTION_KEY,
    });
  }),
);
securityRoutes.post(
  "/mfa/enroll",
  wrap(async (req, res) => {
    const profile = await SecurityProfile.findOne({ user: req.user._id });
    if (profile?.enabled) throw fail("MFA is already enabled", 409);
    const secret = base32(crypto.randomBytes(20));
    await SecurityProfile.findOneAndUpdate(
      { user: req.user._id },
      {
        $set: {
          pendingSecret: encrypt(secret),
          pendingExpires: new Date(Date.now() + 10 * 60000),
        },
      },
      { upsert: true },
    );
    const uri = `otpauth://totp/${encodeURIComponent("QuickFix:" + req.user.email)}?secret=${secret}&issuer=QuickFix&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri) });
  }),
);
securityRoutes.post(
  "/mfa/confirm",
  wrap(async (req, res) => {
    const { code } = validate(codeSchema, req.body),
      p = await SecurityProfile.findOne({
        user: req.user._id,
        enabled: false,
        pendingExpires: { $gt: new Date() },
      }).select("+pendingSecret");
    if (!p) throw fail("Enrollment expired", 400);
    const counter = matchTotp(decrypt(p.pendingSecret), code);
    if (counter === null) throw fail("Invalid authenticator code", 401);
    const recoveryCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(12).toString("hex"),
    );
    const updated = await SecurityProfile.findOneAndUpdate(
      { _id: p._id, enabled: false, pendingSecret: p.pendingSecret },
      {
        $set: {
          enabled: true,
          secret: p.pendingSecret,
          lastCounter: counter,
          recoveryHashes: recoveryCodes.map(digest),
        },
        $unset: { pendingSecret: 1, pendingExpires: 1 },
        $inc: { version: 1 },
      },
      { new: true },
    );
    if (!updated) throw fail("Enrollment changed", 409);
    res.json({ token: sessionToken(req.user, updated), recoveryCodes });
  }),
);
export async function verifyMFA(user, code) {
  const p = await SecurityProfile.findOne({ user, enabled: true }).select(
    "+secret +recoveryHashes",
  );
  if (!p) throw fail("MFA is not enabled", 409);
  const recovery = digest(code);
  let filter, update;
  if (p.recoveryHashes.includes(recovery)) {
    filter = { _id: p._id, recoveryHashes: recovery };
    update = { $pull: { recoveryHashes: recovery } };
  } else {
    const counter = matchTotp(decrypt(p.secret), code, p.lastCounter);
    if (counter === null) throw fail("Invalid or already used code", 401);
    filter = {
      _id: p._id,
      $or: [{ lastCounter: { $lt: counter } }, { lastCounter: null }],
    };
    update = { $set: { lastCounter: counter } };
  }
  const updated = await SecurityProfile.findOneAndUpdate(filter, update, {
    new: true,
  });
  if (!updated) throw fail("Code has already been used", 401);
  return updated;
}
securityRoutes.post(
  "/mfa/verify",
  wrap(async (req, res) => {
    const { code } = validate(codeSchema, req.body),
      p = await verifyMFA(req.user._id, code);
    res.json({ token: sessionToken(req.user, p) });
  }),
);
securityRoutes.post(
  "/mfa/disable",
  wrap(async (req, res) => {
    const { code } = validate(codeSchema, req.body);
    await verifyMFA(req.user._id, code);
    await SecurityProfile.updateOne(
      { user: req.user._id },
      {
        $set: { enabled: false },
        $unset: { secret: 1, recoveryHashes: 1 },
        $inc: { version: 1 },
      },
    );
    res.json({ disabled: true });
  }),
);
// Provider metadata is operator configured, never accepted from untrusted callback parameters.
let configPromise;
async function ssoConfig() {
  if (
    !process.env.OIDC_ISSUER ||
    !process.env.OIDC_CLIENT_ID ||
    !process.env.OIDC_CLIENT_SECRET
  )
    throw fail("Configure the OpenID Connect provider first", 503);
  if (!process.env.OIDC_ISSUER.startsWith("https://"))
    throw fail("OIDC requires HTTPS", 503);
  return (configPromise ||= oidc
    .discovery(
      new URL(process.env.OIDC_ISSUER),
      process.env.OIDC_CLIENT_ID,
      process.env.OIDC_CLIENT_SECRET,
    )
    .catch((error) => {
      configPromise = null;
      throw error;
    }));
}
const origin = () =>
  new URL(process.env.FRONTEND_URL || "http://localhost:5173").origin;
const callback = () =>
  new URL(
    "/api/sso/callback",
    process.env.BACKEND_URL || "http://localhost:5000",
  ).href;
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/api/sso",
  maxAge: 10 * 60000,
});
async function beginSSO(workspace, user, res) {
  requireFeature(workspace, "sso");
  if (!workspace.ssoEnabled)
    throw fail("SSO is disabled for this workspace", 403);
  const config = await ssoConfig(),
    state = oidc.randomState(),
    verifier = oidc.randomPKCECodeVerifier(),
    nonce = oidc.randomNonce(),
    browser = crypto.randomBytes(32).toString("hex");
  await AuthFlow.create({
    hash: digest(state),
    kind: "oidc",
    workspace: workspace._id,
    user: user?._id,
    payload: { browser: digest(browser), verifier: encrypt(verifier), nonce },
    expiresAt: new Date(Date.now() + 600000),
  });
  res.cookie("qf_sso", browser, cookieOptions());
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: callback(),
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
  }).href;
}
export const ssoPublicRoutes = express.Router();
ssoPublicRoutes.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
ssoPublicRoutes.get(
  "/:slug/start",
  wrap(async (req, res) => {
    const workspace = await Workspace.findOne({
      slug: validate(
        Joi.string()
          .pattern(/^[a-z0-9-]{3,50}$/)
          .required(),
        req.params.slug,
      ),
    });
    if (!workspace) throw fail("Workspace not found", 404);
    res.redirect(await beginSSO(workspace, null, res));
  }),
);
ssoPublicRoutes.get(
  "/callback",
  wrap(async (req, res) => {
    const state = String(req.query.state || ""),
      flow = await AuthFlow.findOneAndDelete({
        hash: digest(state),
        kind: "oidc",
        expiresAt: { $gt: new Date() },
        "payload.browser": digest(req.cookies?.qf_sso || ""),
      });
    if (!flow) throw fail("SSO session is invalid or expired", 401);
    const workspace = await Workspace.findById(flow.workspace);
    requireFeature(workspace, "sso");
    if (!workspace.ssoEnabled) throw fail("SSO disabled", 403);
    const config = await ssoConfig(),
      tokens = await oidc.authorizationCodeGrant(
        config,
        new URL(
          req.originalUrl,
          process.env.BACKEND_URL || "http://localhost:5000",
        ),
        {
          pkceCodeVerifier: decrypt(flow.payload.verifier),
          expectedState: state,
          expectedNonce: flow.payload.nonce,
          idTokenExpected: true,
        },
      ),
      claims = tokens.claims();
    if (!claims?.sub) throw fail("Invalid identity", 401);
    let identity;
    if (flow.user) {
      const member = await Membership.findOne({
        workspace: workspace._id,
        user: flow.user,
        active: true,
        role: { $ne: "customer" },
      });
      if (!member) throw fail("Staff membership required", 403);
      identity = await SSOIdentity.findOne({
        workspace: workspace._id,
        issuer: claims.iss,
        subject: claims.sub,
      });
      if (identity && String(identity.user) !== String(flow.user))
        throw fail("Identity is already linked", 409);
      identity = await SSOIdentity.findOneAndUpdate(
        { workspace: workspace._id, issuer: claims.iss, subject: claims.sub },
        { $setOnInsert: { user: flow.user } },
        { upsert: true, new: true },
      );
    } else
      identity = await SSOIdentity.findOne({
        workspace: workspace._id,
        issuer: claims.iss,
        subject: claims.sub,
      });
    if (!identity)
      throw fail(
        "Sign in normally once and link your SSO identity in Security.",
        403,
      );
    if (
      !(await Membership.exists({
        workspace: workspace._id,
        user: identity.user,
        active: true,
      }))
    )
      throw fail("Membership revoked", 403);
    const code = crypto.randomBytes(32).toString("hex");
    await AuthFlow.create({
      hash: digest(code),
      kind: "handoff",
      user: identity.user,
      workspace: workspace._id,
      payload: { browser: digest(req.cookies.qf_sso) },
      expiresAt: new Date(Date.now() + 60000),
    });
    res.redirect(origin() + "/auth/sso?code=" + code);
  }),
);
ssoPublicRoutes.post(
  "/exchange",
  wrap(async (req, res) => {
    const { code } = validate(
        Joi.object({ code: Joi.string().hex().length(64).required() }),
        req.body,
      ),
      flow = await AuthFlow.findOneAndDelete({
        hash: digest(code),
        kind: "handoff",
        expiresAt: { $gt: new Date() },
        "payload.browser": digest(req.cookies?.qf_sso || ""),
      });
    if (!flow) throw fail("SSO exchange expired", 401);
    const { findUserById } = await import("../models/User.js"),
      { user } = await findUserById(flow.user);
    if (!user || user.isActive === false) throw fail("Account disabled", 403);
    res.clearCookie("qf_sso", cookieOptions());
    res.json({
      token: jwt.sign(
        { id: String(user._id), tokenType: "access", issuedAt: Date.now() },
        jwtSecret(),
        { expiresIn: "12h" },
      ),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        firstName: user.name.split(" ")[0],
        lastName: user.name.split(" ").slice(1).join(" "),
      },
    });
  }),
);
export const permissions = [
  "tickets.read",
  "tickets.write",
  "contacts.read",
  "contacts.write",
  "knowledge.read",
  "knowledge.write",
  "tools.read",
  "tools.write",
  "team.read",
  "team.write",
  "settings.read",
  "settings.write",
  "connections.read",
  "connections.write",
  "billing.read",
  "billing.write",
  "analytics.read",
  "analytics.write",
  "security.read",
  "security.write",
  "migration.read",
  "migration.write",
];
export const enterpriseSecurityRoutes = express.Router();
enterpriseSecurityRoutes.use(authenticate);
enterpriseSecurityRoutes.use("/:workspaceId", workspaceAccess);
enterpriseSecurityRoutes.get(
  "/:workspaceId/sso/status",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json({
      ssoEnabled: req.workspace.ssoEnabled,
      providerConfigured: !!process.env.OIDC_ISSUER,
    }),
  ),
);
enterpriseSecurityRoutes.get(
  "/:workspaceId/security",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      ssoEnabled: req.workspace.ssoEnabled,
      providerConfigured: !!process.env.OIDC_ISSUER,
      permissions,
      roles: await CustomRole.find({ workspace: req.workspace._id }).lean(),
    }),
  ),
);
enterpriseSecurityRoutes.patch(
  "/:workspaceId/security",
  permit("owner"),
  wrap(async (req, res) => {
    const { ssoEnabled } = validate(
      Joi.object({ ssoEnabled: Joi.boolean().required() }),
      req.body,
    );
    if (ssoEnabled) requireFeature(req.workspace, "sso");
    await withActor(req, async (session, workspace) => {
      workspace.ssoEnabled = ssoEnabled;
      await workspace.save({ session });
      await audit(
        workspace._id,
        req.user._id,
        "security.sso",
        workspace._id,
        session,
        { ssoEnabled },
      );
    });
    res.json({ ssoEnabled });
  }),
);
enterpriseSecurityRoutes.post(
  "/:workspaceId/sso/link",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json({ url: await beginSSO(req.workspace, req.user, res) }),
  ),
);
enterpriseSecurityRoutes.post(
  "/:workspaceId/roles",
  permit("owner"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "roles");
    const input = validate(
      Joi.object({
        name: Joi.string().trim().min(2).max(80).required(),
        permissions: Joi.array()
          .items(Joi.string().valid(...permissions))
          .unique()
          .required(),
      }),
      req.body,
    );
    const row = await withActor(req, async (session) => {
      if (
        (await CustomRole.countDocuments({
          workspace: req.workspace._id,
        }).session(session)) >= 30
      )
        throw fail("Role limit reached", 409);
      return (
        await CustomRole.create([{ ...input, workspace: req.workspace._id }], {
          session,
        })
      )[0];
    });
    res.status(201).json(row);
  }),
);
enterpriseSecurityRoutes.patch(
  "/:workspaceId/roles/assign/:memberId",
  permit("owner"),
  wrap(async (req, res) => {
    const { roleId } = validate(
      Joi.object({
        roleId: Joi.string().hex().length(24).allow(null).required(),
      }),
      req.body,
    );
    await withActor(req, async (session, workspace) => {
      if (roleId) {
        requireFeature(workspace, "roles");
        if (
          !(await CustomRole.exists({
            _id: objectId(roleId),
            workspace: workspace._id,
          }).session(session))
        )
          throw fail("Role not found", 404);
      }
      const member = await Membership.findOne({
        _id: objectId(req.params.memberId),
        workspace: workspace._id,
        role: { $nin: ["owner", "customer"] },
      }).session(session);
      if (!member) throw fail("Staff member not found", 404);
      member.customRole = roleId || undefined;
      await member.save({ session });
      await audit(
        workspace._id,
        req.user._id,
        "security.role",
        member._id,
        session,
        { roleId },
      );
    });
    res.json({ updated: true });
  }),
);

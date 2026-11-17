import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import { SAML } from "@node-saml/node-saml";
import { AuthFlow, Workspace, Membership, SSOIdentity } from "./models.js";
import { digest } from "./tickets.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { workspaceAccess, permit } from "./access.js";
import { requireFeature, seatAllowed } from "./entitlements.js";
import { validate, fail } from "./validation.js";
const origin = () =>
  new URL(process.env.BACKEND_URL || "http://localhost:5000").origin;
const cookie = () => ({
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/api/sso",
  maxAge: 600000,
});
export function samlConfigured() {
  return [
    "SAML_ENTRY_POINT",
    "SAML_IDP_ISSUER",
    "SAML_IDP_CERT",
    "SAML_SP_KEY",
    "SAML_SP_CERT",
  ].every((k) => !!process.env[k]);
}
export function samlClient(workspace) {
  if (!samlConfigured()) throw fail("SAML provider is not configured", 503);
  if (
    !process.env.SAML_ENTRY_POINT.startsWith("https://") ||
    !origin().startsWith("https://")
  )
    throw fail("SAML requires HTTPS for the API and identity provider", 503);
  const scope = `saml-cache:${workspace._id}:`;
  const cacheProvider = {
    async saveAsync(key, value) {
      await AuthFlow.create({
        hash: digest(scope + key),
        kind: "saml-cache",
        workspace: workspace._id,
        payload: { value },
        expiresAt: new Date(Date.now() + 600000),
      });
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) {
      return (
        (
          await AuthFlow.findOne({
            hash: digest(scope + key),
            expiresAt: { $gt: new Date() },
          })
        )?.payload.value || null
      );
    },
    async removeAsync(key) {
      return (
        (await AuthFlow.findOneAndDelete({ hash: digest(scope + key) }))
          ?.payload.value || null
      );
    },
    async consumeAsync(key) {
      return (
        (
          await AuthFlow.findOneAndDelete({
            hash: digest(scope + key),
            expiresAt: { $gt: new Date() },
          })
        )?.payload.value || null
      );
    },
    async saveIfAbsentAsync(key, value, expiresAtMs) {
      try {
        await AuthFlow.create({
          hash: digest(scope + key),
          kind: "saml-replay",
          workspace: workspace._id,
          payload: { value },
          expiresAt: new Date(expiresAtMs),
        });
        return true;
      } catch (e) {
        if (e.code === 11000) return false;
        throw e;
      }
    },
  };
  return new SAML({
    entryPoint: process.env.SAML_ENTRY_POINT,
    idpIssuer: process.env.SAML_IDP_ISSUER,
    idpCert: process.env.SAML_IDP_CERT.replace(/\\n/g, "\n"),
    privateKey: process.env.SAML_SP_KEY.replace(/\\n/g, "\n"),
    publicCert: process.env.SAML_SP_CERT.replace(/\\n/g, "\n"),
    issuer: `${origin()}/api/sso/saml/${workspace.slug}/metadata`,
    callbackUrl: `${origin()}/api/sso/saml/${workspace.slug}/acs`,
    audience: `${origin()}/api/sso/saml/${workspace.slug}/metadata`,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    validateInResponseTo: "always",
    rejectReplayedAssertions: true,
    requestIdExpirationPeriodMs: 600000,
    acceptedClockSkewMs: 30000,
    maxAssertionAgeMs: 600000,
    cacheProvider,
  });
}
async function begin(w, user, res) {
  requireFeature(w, "sso");
  if (!w.ssoEnabled) throw fail("SSO is disabled", 403);
  const saml = samlClient(w),
    relay = crypto.randomBytes(32).toString("hex"),
    browser = crypto.randomBytes(32).toString("hex");
  await AuthFlow.create({
    hash: digest(relay),
    kind: "saml-login",
    workspace: w._id,
    user: user?._id,
    payload: { browser: digest(browser) },
    expiresAt: new Date(Date.now() + 600000),
  });
  res.cookie("qf_sso", browser, cookie());
  return saml.getAuthorizeUrlAsync(relay, {});
}
export const samlAdmin = express.Router();
samlAdmin.use(authenticate);
samlAdmin.use("/:workspaceId", workspaceAccess);
samlAdmin.post(
  "/:workspaceId/sso/saml/link",
  permit("owner", "admin", "agent", "analyst"),
  wrap(async (req, res) =>
    res.json({ url: await begin(req.workspace, req.user, res) }),
  ),
);
export const samlPublic = express.Router();
samlPublic.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
samlPublic.get(
  "/saml/:slug/metadata",
  wrap(async (req, res) => {
    const w = await Workspace.findOne({ slug: req.params.slug });
    if (!w) throw fail("Workspace not found", 404);
    requireFeature(w, "sso");
    res
      .type("application/xml")
      .send(
        samlClient(w).generateServiceProviderMetadata(
          null,
          process.env.SAML_SP_CERT.replace(/\\n/g, "\n"),
        ),
      );
  }),
);
samlPublic.get(
  "/saml/:slug/start",
  wrap(async (req, res) => {
    const w = await Workspace.findOne({ slug: req.params.slug });
    if (!w) throw fail("Workspace not found", 404);
    res.redirect(await begin(w, null, res));
  }),
);
samlPublic.post(
  "/saml/:slug/acs",
  express.urlencoded({ extended: false, limit: "1mb" }),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        RelayState: Joi.string().hex().length(64).required(),
        SAMLResponse: Joi.string().max(1000000).required(),
      }),
      req.body,
    );
    const w = await Workspace.findOne({
      slug: req.params.slug,
      ssoEnabled: true,
    });
    if (!w) throw fail("SSO unavailable", 404);
    requireFeature(w, "sso");
    const flow = await AuthFlow.findOneAndDelete({
      hash: digest(input.RelayState),
      kind: "saml-login",
      workspace: w._id,
      expiresAt: { $gt: new Date() },
      "payload.browser": digest(req.cookies?.qf_sso || ""),
    });
    if (!flow) throw fail("SAML session expired or already used", 401);
    const { profile, loggedOut } = await samlClient(
      w,
    ).validatePostResponseAsync({ SAMLResponse: input.SAMLResponse });
    if (
      loggedOut ||
      !profile?.nameID ||
      profile.issuer !== process.env.SAML_IDP_ISSUER
    )
      throw fail("Invalid SAML identity", 401);
    const query = {
      workspace: w._id,
      issuer: "saml:" + profile.issuer,
      subject: profile.nameID,
    };
    let identity = await SSOIdentity.findOne(query);
    if (flow.user) {
      if (identity && String(identity.user) !== String(flow.user))
        throw fail("Identity already linked", 409);
      const member = await Membership.findOne({
        workspace: w._id,
        user: flow.user,
        active: true,
        role: { $ne: "customer" },
      });
      if (!member || !(await seatAllowed(w, member)))
        throw fail("Staff access revoked", 403);
      identity = await SSOIdentity.findOneAndUpdate(
        query,
        { $setOnInsert: { user: flow.user } },
        { upsert: true, new: true },
      );
    }
    if (!identity)
      throw fail(
        "Sign in normally and link this SAML identity from Security first",
        403,
      );
    const member = await Membership.findOne({
      workspace: w._id,
      user: identity.user,
      active: true,
      role: { $ne: "customer" },
    });
    if (!member || !(await seatAllowed(w, member)))
      throw fail("Staff access revoked", 403);
    const code = crypto.randomBytes(32).toString("hex");
    await AuthFlow.create({
      hash: digest(code),
      kind: "handoff",
      workspace: w._id,
      user: identity.user,
      payload: { browser: digest(req.cookies.qf_sso) },
      expiresAt: new Date(Date.now() + 60000),
    });
    res.redirect(
      new URL(
        "/auth/sso?code=" + code,
        process.env.FRONTEND_URL || "http://localhost:5173",
      ).href,
    );
  }),
);

import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import { User, findUserById } from "../models/User.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  Workspace,
  Membership,
  Ticket,
  ProvisionKey,
  ProvisionUser,
  SSOIdentity,
} from "./models.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  inWorkspace,
  assertSeat,
  audit,
} from "./access.js";
import { requireFeature } from "./entitlements.js";
import { digest } from "./tickets.js";
import { fail, validate } from "./validation.js";
const schemaURI = "urn:ietf:params:scim:schemas:core:2.0:User";
const base = (w) =>
  `${new URL(process.env.BACKEND_URL || "http://localhost:5000").origin}/api/scim/${w}/v2`;
const serialize = (row, member) =>
  !member
    ? null
    : {
        schemas: [schemaURI],
        id: String(row._id),
        externalId: row.externalId,
        userName: row.userName,
        displayName: member.name,
        active: member.active,
        emails: [{ value: row.userName, primary: true }],
        meta: {
          resourceType: "User",
          created: row.createdAt,
          lastModified: member.updatedAt,
          location: `${base(row.workspace)}/Users/${row._id}`,
        },
      };
export const scimAdmin = express.Router();
scimAdmin.use(authenticate);
scimAdmin.use("/:workspaceId", workspaceAccess);
scimAdmin.post(
  "/:workspaceId/security/scim-token",
  permit("owner"),
  wrap(async (req, res) => {
    requireFeature(req.workspace, "sso");
    const token = "scim_" + crypto.randomBytes(32).toString("hex");
    await withActor(req, async (session, w) => {
      await ProvisionKey.findOneAndUpdate(
        { workspace: w._id },
        {
          $set: {
            hash: digest(token),
            expiresAt: new Date(Date.now() + 90 * 86400000),
          },
        },
        { upsert: true, session },
      );
      await audit(w._id, req.user._id, "scim.key-rotated", w._id, session);
    });
    res.json({ token, baseUrl: base(req.workspace._id), expiresInDays: 90 });
  }),
);
scimAdmin.delete(
  "/:workspaceId/security/scim-token",
  permit("owner"),
  wrap(async (req, res) => {
    await withActor(req, async (session, w) => {
      await ProvisionKey.deleteMany({ workspace: w._id }, { session });
      await audit(w._id, req.user._id, "scim.key-revoked", w._id, session);
    });
    res.sendStatus(204);
  }),
);
export const scimRoutes = express.Router();
scimRoutes.use(
  express.json({
    type: ["application/scim+json", "application/json"],
    limit: "128kb",
  }),
);
scimRoutes.use(
  rateLimit({
    windowMs: 60000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
scimRoutes.use(
  "/:workspaceId/v2",
  wrap(async (req, res, next) => {
    const token = req.get("Authorization")?.replace(/^Bearer /, "");
    if (!/^scim_[a-f0-9]{64}$/.test(token || ""))
      throw fail("Invalid provisioning token", 401);
    const w = await Workspace.findById(objectId(req.params.workspaceId));
    if (!w) throw fail("Invalid provisioning token", 401);
    requireFeature(w, "sso");
    if (
      !(await ProvisionKey.exists({
        workspace: w._id,
        hash: digest(token),
        expiresAt: { $gt: new Date() },
      }))
    )
      throw fail("Provisioning token expired or revoked", 401);
    req.provisionWorkspace = w;
    res.type("application/scim+json");
    next();
  }),
);
scimRoutes.get("/:workspaceId/v2/ServiceProviderConfig", (req, res) =>
  res.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer Token",
        description: "Owner-issued workspace token",
        primary: true,
      },
    ],
  }),
);
scimRoutes.get("/:workspaceId/v2/ResourceTypes", (req, res) =>
  res.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: schemaURI,
      },
    ],
  }),
);
scimRoutes.get(
  "/:workspaceId/v2/Users",
  wrap(async (req, res) => {
    const { filter, startIndex, count } = validate(
      Joi.object({
        filter: Joi.string().max(500),
        startIndex: Joi.number().integer().min(1).default(1),
        count: Joi.number().integer().min(0).max(100).default(100),
      }),
      req.query,
    );
    const query = { workspace: req.provisionWorkspace._id };
    if (filter) {
      const match = /^(userName|externalId) eq "([^"\\]{1,300})"$/.exec(filter);
      if (!match)
        throw fail("Only userName/externalId eq filters are supported");
      query[match[1]] =
        match[1] === "userName" ? match[2].toLowerCase() : match[2];
    }
    const rows = count
      ? await ProvisionUser.find(query)
          .sort({ _id: 1 })
          .skip(startIndex - 1)
          .limit(count)
          .lean()
      : [];
    const members = await Membership.find({
      workspace: req.provisionWorkspace._id,
      _id: { $in: rows.map((r) => r.member) },
    }).lean();
    const Resources = rows
      .map((r) =>
        serialize(
          r,
          members.find((m) => String(m._id) === String(r.member)),
        ),
      )
      .filter(Boolean);
    res.json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: await ProvisionUser.countDocuments(query),
      startIndex,
      itemsPerPage: Resources.length,
      Resources,
    });
  }),
);
scimRoutes.get(
  "/:workspaceId/v2/Users/:id",
  wrap(async (req, res) => {
    const row = await ProvisionUser.findOne({
      _id: objectId(req.params.id),
      workspace: req.provisionWorkspace._id,
    });
    if (!row) throw fail("Provisioned user not found", 404);
    res.json(serialize(row, await Membership.findById(row.member)));
  }),
);
scimRoutes.post(
  "/:workspaceId/v2/Users",
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        schemas: Joi.array().items(Joi.string()).required(),
        externalId: Joi.string().min(1).max(300).required(),
        userName: Joi.string().email().lowercase().required(),
        displayName: Joi.string().min(1).max(100).required(),
        active: Joi.boolean().default(true),
        name: Joi.object({
          givenName: Joi.string(),
          familyName: Joi.string(),
          formatted: Joi.string(),
        }),
        emails: Joi.array().items(
          Joi.object({
            value: Joi.string().email(),
            primary: Joi.boolean(),
            type: Joi.string(),
          }),
        ),
      }),
      req.body,
    );
    const result = await inWorkspace(
      req.provisionWorkspace._id,
      async (session, w) => {
        requireFeature(w, "sso");
        if (
          await ProvisionUser.exists({
            workspace: w._id,
            externalId: input.externalId,
          }).session(session)
        )
          throw fail("Provisioned identity already exists", 409);
        let member = await Membership.findOne({
            workspace: w._id,
            email: input.userName,
          }).session(session),
          user;
        if (
          member &&
          (member.role === "owner" ||
            member.role === "customer" ||
            member.customRole)
        )
          throw fail("This membership cannot be managed by SCIM", 409);
        if (!member) {
          // Existing global accounts must explicitly join this company; never auto-link by email.
          if (await User.exists({ email: input.userName }).session(session))
            throw fail(
              "Existing account must join the workspace before provisioning",
              409,
            );
          if (input.active) await assertSeat(w, session);
          [user] = await User.create(
            [
              {
                name: input.displayName,
                email: input.userName,
                password: crypto.randomBytes(32).toString("hex"),
                isVerified: true,
              },
            ],
            { session },
          );
          [member] = await Membership.create(
            [
              {
                workspace: w._id,
                user: user._id,
                email: input.userName,
                name: input.displayName,
                role: "agent",
                active: input.active,
              },
            ],
            { session },
          );
        } else {
          if (input.active && !member.active) await assertSeat(w, session);
          member.name = input.displayName;
          member.active = input.active;
          await member.save({ session });
        }
        const [row] = await ProvisionUser.create(
          [
            {
              workspace: w._id,
              member: member._id,
              externalId: input.externalId,
              userName: input.userName,
            },
          ],
          { session },
        );
        if (process.env.SAML_IDP_ISSUER) {
          const identity = await SSOIdentity.findOne({
            workspace: w._id,
            issuer: "saml:" + process.env.SAML_IDP_ISSUER,
            subject: input.externalId,
          }).session(session);
          if (identity && String(identity.user) !== String(member.user))
            throw fail("SSO subject belongs to another member", 409);
          await SSOIdentity.updateOne(
            {
              workspace: w._id,
              issuer: "saml:" + process.env.SAML_IDP_ISSUER,
              subject: input.externalId,
            },
            { $setOnInsert: { user: member.user } },
            { upsert: true, session },
          );
        }
        await audit(w._id, "scim", "scim.created", member._id, session);
        return serialize(row, member);
      },
    );
    res.status(201).set("Location", result.meta.location).json(result);
  }),
);
async function change(req, active, displayName) {
  return inWorkspace(req.provisionWorkspace._id, async (session, w) => {
    requireFeature(w, "sso");
    const row = await ProvisionUser.findOne({
      _id: objectId(req.params.id),
      workspace: w._id,
    }).session(session);
    if (!row) throw fail("Provisioned user not found", 404);
    const member = await Membership.findOne({
      _id: row.member,
      workspace: w._id,
    }).session(session);
    if (
      !member ||
      member.role === "owner" ||
      member.role === "customer" ||
      member.customRole
    )
      throw fail("Protected membership", 409);
    if (active === true && !member.active) await assertSeat(w, session);
    if (active !== undefined) member.active = active;
    if (displayName !== undefined) member.name = displayName;
    await member.save({ session });
    if (!member.active)
      await Ticket.updateMany(
        {
          workspace: w._id,
          assignedTo: member._id,
          status: { $nin: ["Resolved", "Closed"] },
        },
        { $unset: { assignedTo: 1 }, $inc: { version: 1 } },
        { session },
      );
    await audit(w._id, "scim", "scim.updated", member._id, session);
    return serialize(row, member);
  });
}
scimRoutes.patch(
  "/:workspaceId/v2/Users/:id",
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        schemas: Joi.array().items(Joi.string()).required(),
        Operations: Joi.array()
          .items(
            Joi.object({
              op: Joi.string().lowercase().valid("replace", "add").required(),
              path: Joi.string().valid("active", "displayName"),
              value: Joi.alternatives()
                .try(
                  Joi.boolean(),
                  Joi.string().min(1).max(100),
                  Joi.object({
                    active: Joi.boolean(),
                    displayName: Joi.string().min(1).max(100),
                  }).min(1),
                )
                .required(),
            }),
          )
          .min(1)
          .max(10)
          .required(),
      }),
      req.body,
    );
    const update = {};
    for (const op of input.Operations) {
      if (op.path) update[op.path] = op.value;
      else if (op.value && typeof op.value === "object")
        Object.assign(update, op.value);
      else throw fail("Invalid patch value");
    }
    validate(
      Joi.object({
        active: Joi.boolean().strict(),
        displayName: Joi.string().min(1).max(100),
      }).min(1),
      update,
    );
    res.json(await change(req, update.active, update.displayName));
  }),
);
scimRoutes.delete(
  "/:workspaceId/v2/Users/:id",
  wrap(async (req, res) => {
    await change(req, false);
    res.sendStatus(204);
  }),
);
scimRoutes.use((error, req, res, next) => {
  const status = error.code === 11000 ? 409 : error.statusCode || 400;
  res
    .status(status)
    .type("application/scim+json")
    .json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail: error.code === 11000 ? "Provisioning conflict" : error.message,
    });
});

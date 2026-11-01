import express from "express";
import { seatAllowed } from "./entitlements.js";
import Joi from "joi";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth.js";
import { findUserById } from "../models/User.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  Workspace,
  Membership,
  ApiKey,
  Ticket,
  Contact,
  Article,
} from "./models.js";
import {
  workspaceAccess,
  permit,
  inWorkspace,
  withActor,
  objectId,
} from "./access.js";
import { fail, validate, text, priority } from "./validation.js";
import { digest, createTicket, updateTicket } from "./tickets.js";
export const keyRoutes = express.Router();
keyRoutes.use(authenticate);
keyRoutes.use("/:workspaceId", workspaceAccess);
keyRoutes.get(
  "/:workspaceId/api-keys",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json(await ApiKey.find({ workspace: req.workspace._id }).lean()),
  ),
);
keyRoutes.post(
  "/:workspaceId/api-keys",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
        Joi.object({
          name: Joi.string().min(2).max(100).required(),
          scopes: Joi.array()
            .min(1)
            .max(4)
            .unique()
            .items(
              Joi.string().valid(
                "tickets:read",
                "tickets:write",
                "contacts:read",
                "articles:read",
              ),
            )
            .required(),
        }),
        req.body,
      ),
      token = "qf_" + crypto.randomBytes(32).toString("hex");
    const key = await ApiKey.create({
      ...input,
      workspace: req.workspace._id,
      member: req.member._id,
      hash: digest(token),
      prefix: token.slice(0, 10),
      expiresAt: new Date(Date.now() + 90 * 86400000),
    });
    res.status(201).json({ id: key._id, token, expiresAt: key.expiresAt });
  }),
);
keyRoutes.delete(
  "/:workspaceId/api-keys/:keyId",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const result = await ApiKey.updateOne(
      { _id: objectId(req.params.keyId), workspace: req.workspace._id },
      { $set: { revokedAt: new Date() } },
    );
    if (!result.matchedCount) throw fail("API key not found", 404);
    res.json({ revoked: true });
  }),
);
export const developerRoutes = express.Router();
developerRoutes.use(
  "/:workspaceId",
  wrap(async (req, res, next) => {
    const token = req.get("Authorization")?.replace(/^Bearer /, "");
    if (!/^qf_[a-f0-9]{64}$/.test(token || ""))
      throw fail("Invalid API credential", 401);
    const workspaceId = objectId(req.params.workspaceId),
      key = await ApiKey.findOne({
        workspace: workspaceId,
        hash: digest(token),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
    if (!key) throw fail("Invalid API credential", 401);
    const member = await Membership.findOne({
        _id: key.member,
        workspace: workspaceId,
        active: true,
        role: { $in: ["owner", "admin", "agent"] },
      }),
      workspace = await Workspace.findById(workspaceId);
    if (!member || !workspace || !(await seatAllowed(workspace, member)))
      throw fail("API access revoked", 401);
    if (member.customRole)
      throw fail(
        "Custom role staff must use the interactive API with their permissions",
        403,
      );
    const { user } = await findUserById(member.user);
    if (!user || user.isActive === false) throw fail("API access revoked", 401);
    req.user = user;
    req.member = member;
    req.workspace = workspace;
    req.apiKey = key;
    next();
  }),
);
developerRoutes.use(
  rateLimit({
    windowMs: 15 * 60000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
const scope = (name) => (req, res, next) =>
  req.apiKey.scopes.includes(name)
    ? next()
    : res
        .status(403)
        .json({ error: "API key scope does not permit this action" });
developerRoutes.get(
  "/:workspaceId/tickets",
  scope("tickets:read"),
  wrap(async (req, res) => {
    const { limit } = validate(
      Joi.object({ limit: Joi.number().integer().min(1).max(100).default(30) }),
      req.query,
    );
    res.json(
      await Ticket.find({ workspace: req.workspace._id, mergedInto: null })
        .limit(limit)
        .sort({ updatedAt: -1 })
        .lean(),
    );
  }),
);
developerRoutes.post(
  "/:workspaceId/tickets",
  scope("tickets:write"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        subject: Joi.string().min(3).max(200).required(),
        description: text.min(3).required(),
        email: Joi.string().email().lowercase().required(),
        name: Joi.string().max(100),
        priority,
        customFields: Joi.object(),
      }),
      req.body,
    );
    res
      .status(201)
      .json(
        (
          await withActor(req, (session, workspace) =>
            createTicket(workspace, input, req.user._id, session),
          )
        ).ticket,
      );
  }),
);
developerRoutes.patch(
  "/:workspaceId/tickets/:ticketId",
  scope("tickets:write"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        status: Joi.string().max(60),
        priority,
        expectedVersion: Joi.number().integer().min(0),
      }).min(1),
      req.body,
    );
    res.json(
      await withActor(req, (session, workspace) =>
        updateTicket(req, req.params.ticketId, input, session, workspace),
      ),
    );
  }),
);
developerRoutes.get(
  "/:workspaceId/contacts",
  scope("contacts:read"),
  wrap(async (req, res) =>
    res.json(
      await Contact.find({ workspace: req.workspace._id })
        .select("name email phone company")
        .limit(100)
        .lean(),
    ),
  ),
);
developerRoutes.get(
  "/:workspaceId/articles",
  scope("articles:read"),
  wrap(async (req, res) =>
    res.json(
      await Article.find({ workspace: req.workspace._id, published: true })
        .limit(100)
        .lean(),
    ),
  ),
);

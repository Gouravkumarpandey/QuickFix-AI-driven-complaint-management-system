import express from "express";
import Joi from "joi";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { ProvisionGroup, ProvisionUser, Membership } from "./models.js";
import { objectId, inWorkspace, audit } from "./access.js";
import { requireFeature } from "./entitlements.js";
import { validate, fail } from "./validation.js";
const schema = "urn:ietf:params:scim:schemas:core:2.0:Group";
const listSchema = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const member = Joi.object({
  value: Joi.string().hex().length(24).required(),
  display: Joi.string().max(100),
  $ref: Joi.string().max(1000),
});
const fields = Joi.object({
  schemas: Joi.array().items(Joi.string()).required(),
  displayName: Joi.string().trim().min(1).max(60).required(),
  externalId: Joi.string().min(1).max(300),
  members: Joi.array().items(member).max(1000).default([]),
});
const base = (w) =>
  `${new URL(process.env.BACKEND_URL || "http://localhost:5000").origin}/api/scim/${w}/v2`;
function serialize(g) {
  return {
    schemas: [schema],
    id: String(g._id),
    externalId: g.externalId,
    displayName: g.displayName,
    members: g.members.map((id) => ({
      value: String(id),
      $ref: `${base(g.workspace)}/Users/${id}`,
    })),
    meta: {
      resourceType: "Group",
      created: g.createdAt,
      lastModified: g.updatedAt,
      location: `${base(g.workspace)}/Groups/${g._id}`,
    },
  };
}
async function sync(w, session) {
  // Derived routing groups are separate from manually maintained groups and never grant roles.
  const groups = await ProvisionGroup.find({ workspace: w }).session(session),
    users = await ProvisionUser.find({ workspace: w }).session(session);
  for (const u of users)
    await Membership.updateOne(
      { _id: u.member, workspace: w },
      {
        $set: {
          scimGroups: groups
            .filter((g) => g.members.some((id) => String(id) === String(u._id)))
            .map((g) => g.displayName),
        },
      },
      { session },
    );
}
async function save(req, mode) {
  return inWorkspace(req.provisionWorkspace._id, async (session, w) => {
    requireFeature(w, "sso");
    let group =
      mode === "create"
        ? new ProvisionGroup({ workspace: w._id, members: [] })
        : await ProvisionGroup.findOne({
            _id: objectId(req.params.id),
            workspace: w._id,
          }).session(session);
    if (!group) throw fail("Group not found", 404);
    if (mode === "delete") {
      await group.deleteOne({ session });
      await sync(w._id, session);
      await audit(w._id, "scim", "scim.group-deleted", group._id, session);
      return;
    }
    if (mode === "patch") {
      const input = validate(
        Joi.object({
          schemas: Joi.array().items(Joi.string()).required(),
          Operations: Joi.array()
            .items(
              Joi.object({
                op: Joi.string()
                  .lowercase()
                  .valid("add", "replace", "remove")
                  .required(),
                path: Joi.string().max(200),
                value: Joi.any(),
              }),
            )
            .min(1)
            .max(50)
            .required(),
        }),
        req.body,
      );
      for (const op of input.Operations) {
        const match = /^members\[value eq "([a-f0-9]{24})"\]$/i.exec(
          op.path || "",
        );
        if (match && op.op === "remove") {
          group.members = group.members.filter(
            (id) => String(id) !== match[1].toLowerCase(),
          );
          continue;
        }
        if (op.path === "members") {
          if (op.op === "remove") group.members = [];
          else {
            const items = validate(
              Joi.array().items(member).max(1000).required(),
              op.value,
            );
            group.members =
              op.op === "add"
                ? [...group.members, ...items.map((m) => m.value)]
                : items.map((m) => m.value);
          }
        } else if (op.path === "displayName" && op.op !== "remove")
          group.displayName = validate(
            Joi.string().trim().min(1).max(60).required(),
            op.value,
          );
        else if (!op.path && op.op !== "remove") {
          const value = validate(
            Joi.object({
              displayName: Joi.string().trim().min(1).max(60),
              members: Joi.array().items(member).max(1000),
            }).min(1),
            op.value,
          );
          if (value.displayName) group.displayName = value.displayName;
          if (value.members)
            group.members =
              op.op === "add"
                ? [...group.members, ...value.members.map((m) => m.value)]
                : value.members.map((m) => m.value);
        } else throw fail("Unsupported group patch path");
      }
    } else {
      const input = validate(fields, req.body);
      group.displayName = input.displayName;
      group.externalId = input.externalId;
      group.members = input.members.map((m) => m.value);
    }
    group.members = [...new Set(group.members.map(String))];
    if (group.members.length > 1000) throw fail("Group member limit exceeded");
    if (
      (await ProvisionUser.countDocuments({
        workspace: w._id,
        _id: { $in: group.members },
      }).session(session)) !== group.members.length
    )
      throw fail(
        "Every group member must be a provisioned user in this workspace",
      );
    if (
      mode === "create" &&
      (await ProvisionGroup.countDocuments({ workspace: w._id }).session(
        session,
      )) >= 100
    )
      throw fail("Workspace group limit reached", 409);
    await group.save({ session });
    await sync(w._id, session);
    await audit(w._id, "scim", "scim.group-updated", group._id, session);
    return serialize(group);
  });
}
export const scimGroups = express.Router({ mergeParams: true });
scimGroups.get(
  "/",
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
      const m = /^(displayName|externalId) eq "([^"\\]{1,300})"$/.exec(filter);
      if (!m)
        throw fail("Only displayName/externalId eq filters are supported");
      query[m[1]] = m[2];
    }
    const rows = count
      ? await ProvisionGroup.find(query)
          .sort({ _id: 1 })
          .skip(startIndex - 1)
          .limit(count)
      : [];
    res.json({
      schemas: [listSchema],
      totalResults: await ProvisionGroup.countDocuments(query),
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(serialize),
    });
  }),
);
scimGroups.get(
  "/:id",
  wrap(async (req, res) => {
    const g = await ProvisionGroup.findOne({
      _id: objectId(req.params.id),
      workspace: req.provisionWorkspace._id,
    });
    if (!g) throw fail("Group not found", 404);
    res.json(serialize(g));
  }),
);
scimGroups.post(
  "/",
  wrap(async (req, res) => {
    const g = await save(req, "create");
    res.status(201).set("Location", g.meta.location).json(g);
  }),
);
scimGroups.put(
  "/:id",
  wrap(async (req, res) => res.json(await save(req, "replace"))),
);
scimGroups.patch(
  "/:id",
  wrap(async (req, res) => res.json(await save(req, "patch"))),
);
scimGroups.delete(
  "/:id",
  wrap(async (req, res) => {
    await save(req, "delete");
    res.sendStatus(204);
  }),
);

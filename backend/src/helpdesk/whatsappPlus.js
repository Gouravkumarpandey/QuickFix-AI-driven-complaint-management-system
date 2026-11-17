import express from "express";
import Joi from "joi";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Connector } from "./models.js";
import { decrypt } from "./connectors.js";
import {
  workspaceAccess,
  permit,
  objectId,
  withActor,
  audit,
} from "./access.js";
import { validate, fail } from "./validation.js";
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
export async function metaTemplates(
  c,
  method = "GET",
  input,
  fetcher = fetch,
  after,
) {
  if (!/^\d{5,30}$/.test(c.config.businessAccountId || ""))
    throw fail("Set the WhatsApp Business Account ID first", 409);
  const url = new URL(
    `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v23.0"}/${c.config.businessAccountId}/message_templates`,
  );
  if (after) url.searchParams.set("after", after);
  if (method === "GET") {
    url.searchParams.set("limit", "50");
    url.searchParams.set(
      "fields",
      "id,name,status,language,category,components,rejected_reason",
    );
  }
  const r = await fetcher(url, {
    method,
    headers: {
      Authorization: "Bearer " + decrypt(c.token),
      "Content-Type": "application/json",
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    throw fail(
      "Meta template request failed. Check account permissions and template rules.",
      502,
    );
  const data = await r.json();
  return method === "GET"
    ? {
        templates: data.data || [],
        after:
          data.paging?.cursors?.after && data.paging?.next
            ? data.paging.cursors.after
            : null,
      }
    : data;
}
const connector = async (req) => {
  const c = await Connector.findOne({
    _id: objectId(req.params.connectorId),
    workspace: req.workspace._id,
    kind: "whatsapp",
    enabled: true,
  }).select("+token");
  if (!c) throw fail("WhatsApp connection not found", 404);
  return c;
};
router.put(
  "/:workspaceId/connectors/:connectorId/whatsapp-account",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const { businessAccountId } = validate(
      Joi.object({
        businessAccountId: Joi.string()
          .pattern(/^\d{5,30}$/)
          .required(),
      }),
      req.body,
    );
    await withActor(req, async (session, w) => {
      const c = await connector(req);
      c.config = { ...c.config, businessAccountId };
      await c.save({ session });
      await audit(w._id, req.user._id, "whatsapp.account", c._id, session);
    });
    res.json({ configured: true });
  }),
);
router.get(
  "/:workspaceId/connectors/:connectorId/templates",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const { after } = validate(
      Joi.object({ after: Joi.string().max(2000) }),
      req.query,
    );
    res.json(
      await metaTemplates(await connector(req), "GET", undefined, fetch, after),
    );
  }),
);
router.post(
  "/:workspaceId/connectors/:connectorId/templates",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const input = validate(
      Joi.object({
        name: Joi.string()
          .pattern(/^[a-z0-9_]{1,512}$/)
          .required(),
        language: Joi.string()
          .pattern(/^[a-z]{2,3}(_[A-Z]{2})?$/)
          .required(),
        category: Joi.string()
          .valid("UTILITY", "MARKETING", "AUTHENTICATION")
          .required(),
        components: Joi.array()
          .items(
            Joi.object({
              type: Joi.string()
                .valid("HEADER", "BODY", "FOOTER", "BUTTONS")
                .required(),
              format: Joi.string().valid("TEXT", "IMAGE", "VIDEO", "DOCUMENT"),
              text: Joi.string().max(4096),
              example: Joi.object({
                header_text: Joi.array().items(Joi.string().max(1000)).max(10),
                header_handle: Joi.array().items(Joi.string().max(2000)).max(1),
                body_text: Joi.array()
                  .items(Joi.array().items(Joi.string().max(1000)).max(10))
                  .max(1),
              }),
              buttons: Joi.array()
                .items(
                  Joi.object({
                    type: Joi.string()
                      .valid("QUICK_REPLY", "URL", "PHONE_NUMBER")
                      .required(),
                    text: Joi.string().max(25).required(),
                    url: Joi.string()
                      .uri({ scheme: ["https"] })
                      .max(2000),
                    phone_number: Joi.string().pattern(/^\+[1-9]\d{7,14}$/),
                    example: Joi.array().items(Joi.string().max(2000)).max(10),
                  }),
                )
                .max(10),
            }),
          )
          .min(1)
          .max(4)
          .unique("type")
          .required(),
      }),
      req.body,
    );
    const c = await connector(req);
    const result = await metaTemplates(c, "POST", input);
    await withActor(req, (session, w) =>
      audit(
        w._id,
        req.user._id,
        "whatsapp.template-submitted",
        c._id,
        session,
        { name: input.name },
      ),
    );
    res.status(201).json(result);
  }),
);
export default router;

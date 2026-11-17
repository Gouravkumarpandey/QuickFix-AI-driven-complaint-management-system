import express from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { Job, Connector, Attachment, ProvisionKey } from "./models.js";
import { workspaceAccess, permit } from "./access.js";
import { readiness } from "./readiness.js";
import { samlConfigured } from "./saml.js";
export const operationsAdmin = express.Router();
operationsAdmin.use(authenticate);
operationsAdmin.use("/:workspaceId", workspaceAccess);
operationsAdmin.get(
  "/:workspaceId/operations/health",
  permit("owner", "admin"),
  wrap(async (req, res) => {
    const workspace = req.workspace._id;
    const [state, failed, pending, bytes, errors, provision] =
      await Promise.all([
        readiness(),
        Job.countDocuments({ workspace, state: "failed" }),
        Job.countDocuments({
          workspace,
          state: { $in: ["queued", "processing"] },
        }),
        Attachment.aggregate([
          { $match: { workspace } },
          { $group: { _id: null, bytes: { $sum: "$size" } } },
        ]),
        Connector.find({
          workspace,
          enabled: true,
          syncError: { $exists: true, $ne: "" },
        })
          .select("name syncError lastSyncAt")
          .lean(),
        ProvisionKey.findOne({ workspace }).select("expiresAt").lean(),
      ]);
    res.json({
      ...state,
      failedDeliveries: failed,
      pendingDeliveries: pending,
      privateStorageBytes: bytes[0]?.bytes || 0,
      mailboxErrors: errors,
      samlConfigured: samlConfigured(),
      scim: provision ? { expiresAt: provision.expiresAt } : null,
      vectorStore: process.env.QDRANT_URL ? "Qdrant" : "Local exact search",
      mailOAuth: {
        google: !!(
          process.env.GOOGLE_MAIL_CLIENT_ID &&
          process.env.GOOGLE_MAIL_CLIENT_SECRET
        ),
        microsoft: !!(
          process.env.MICROSOFT_MAIL_CLIENT_ID &&
          process.env.MICROSOFT_MAIL_CLIENT_SECRET
        ),
      },
    });
  }),
);
export const metrics = wrap(async (req, res) => {
  const secret = process.env.METRICS_TOKEN || "",
    token = req.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (
    secret.length < 32 ||
    !crypto.timingSafeEqual(
      crypto.createHash("sha256").update(secret).digest(),
      crypto.createHash("sha256").update(token).digest(),
    )
  )
    return res.sendStatus(401);
  const ready = await readiness(),
    failed =
      mongoose.connection.readyState === 1
        ? await Job.countDocuments({ state: "failed" })
        : -1;
  res.type("text/plain").send(
    Object.entries(ready.components)
      .map(
        ([k, v]) => `quickfix_component_ready{component="${k}"} ${v ? 1 : 0}`,
      )
      .join("\n") +
      `\nquickfix_failed_deliveries ${failed}\nquickfix_ready ${ready.ready ? 1 : 0}\n`,
  );
});

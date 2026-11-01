import mongoose from "mongoose";
import net from "node:net";
import express from "express";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import { WorkerHeartbeat, Connector } from "./models.js";
import { workspaceAccess, permit } from "./access.js";
import { entitlement } from "./entitlements.js";
export function scannerReady() {
  if (!process.env.CLAMAV_HOST) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: process.env.CLAMAV_HOST,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let finished = false;
    const done = (value) => {
      if (!finished) {
        finished = true;
        socket.destroy();
        resolve(value);
      }
    };
    socket.setTimeout(2000, () => done(false));
    socket.on("error", () => done(false));
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (data) => done(data.toString().includes("PONG")));
    socket.on("end", () => done(false));
  });
}
export async function readiness() {
  const db = mongoose.connection.readyState === 1;
  let replicaSet = false;
  try {
    if (db)
      replicaSet = !!(
        await mongoose.connection.db.admin().command({ hello: 1 })
      ).setName;
  } catch {}
  const worker =
      db && (await WorkerHeartbeat.findOne({ name: "helpdesk" }).lean()),
    components = {
      database: db,
      transactions: replicaSet,
      worker:
        !!worker && worker.lastSeen > Date.now() - 120000 && !worker.lastError,
      malwareScanner: await scannerReady(),
      encryptionKey: /^[a-f0-9]{64}$/i.test(
        process.env.INTEGRATION_ENCRYPTION_KEY || "",
      ),
      jwtSecret: (process.env.JWT_SECRET || "").length >= 32,
    };
  return { ready: Object.values(components).every(Boolean), components };
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.get(
  "/:workspaceId/readiness",
  permit("owner", "admin"),
  wrap(async (req, res) =>
    res.json({
      ...(await readiness()),
      entitlement: entitlement(req.workspace),
      providers: {
        smtp: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS),
        razorpay: !!(
          process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
        ),
        oidc: !!(
          process.env.OIDC_ISSUER &&
          process.env.OIDC_CLIENT_ID &&
          process.env.OIDC_CLIENT_SECRET
        ),
        embeddings: !!(
          process.env.EMBEDDING_MODEL &&
          (process.env.EMBEDDING_API_KEY || process.env.ANTHROPIC_API_KEY)
        ),
      },
      connections: await Connector.find({ workspace: req.workspace._id })
        .select("kind name enabled lastSyncAt syncError")
        .lean(),
    }),
  ),
);
export default router;

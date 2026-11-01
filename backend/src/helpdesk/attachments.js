import express from "express";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler as wrap } from "../middleware/errorHandler.js";
import {
  workspaceAccess,
  ticketAccess,
  objectId,
  inWorkspace,
  withActor,
} from "./access.js";
import { Attachment } from "./models.js";
import { fail } from "./validation.js";
const directory = () =>
  path.resolve(process.env.PRIVATE_UPLOAD_DIR || "./private-uploads");
export function mimeOf(buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return "image/jpeg";
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  throw fail("Only PNG, JPEG and PDF files are supported");
}
export function scan(buffer) {
  return new Promise((resolve, reject) => {
    if (!process.env.CLAMAV_HOST)
      return reject(
        fail("File uploads require a configured malware scanner", 503),
      );
    const socket = net.createConnection({
      host: process.env.CLAMAV_HOST,
      port: Number(process.env.CLAMAV_PORT || 3310),
    });
    let reply = "";
    socket.setTimeout(15000, () =>
      socket.destroy(new Error("Malware scan timed out")),
    );
    socket.on("error", reject);
    socket.on("data", (chunk) => (reply += chunk.toString()));
    socket.on("end", () =>
      reply.includes(": OK")
        ? resolve()
        : reject(fail("File rejected by malware scanner", 422)),
    );
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < buffer.length; i += 65536) {
        const chunk = buffer.subarray(i, i + 65536),
          length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
const router = express.Router();
router.use(authenticate);
router.use("/:workspaceId", workspaceAccess);
router.post(
  "/:workspaceId/tickets/:ticketId/attachments",
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw fail("Upload the file as application/octet-stream");
    const mime = mimeOf(req.body),
      visibility = req.get("X-Attachment-Visibility") || "public";
    if (!["public", "internal"].includes(visibility))
      throw fail("Invalid attachment visibility");
    const internal = visibility === "internal";
    if (internal && req.member.role === "customer")
      throw fail("Customers cannot upload private staff files", 403);
    await scan(req.body);
    let original;
    try {
      original = decodeURIComponent(req.get("X-File-Name") || "attachment");
    } catch {
      throw fail("Invalid filename");
    }
    const name = String(original)
        .replace(/[\r\n/\\]/g, "_")
        .slice(0, 150),
      storageKey = crypto.randomUUID();
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory(), storageKey), req.body, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      const attachment = await withActor(req, async (session, workspace) => {
        await ticketAccess(req, ticket._id, session);
        const [usage] = await Attachment.aggregate([
          { $match: { workspace: workspace._id } },
          { $group: { _id: null, bytes: { $sum: "$size" } } },
        ]).session(session);
        const activePaid =
            workspace.billing.plan !== "Free" &&
            workspace.billing.expiresAt > new Date() &&
            ["active", "trialing"].includes(workspace.billing.status),
          limit = activePaid ? 10 * 1024 ** 3 : 100 * 1024 ** 2;
        if ((usage?.bytes || 0) + req.body.length > limit)
          throw fail("Workspace attachment storage limit reached", 409);
        const [record] = await Attachment.create(
          [
            {
              workspace: workspace._id,
              ticket: ticket._id,
              name,
              mime,
              size: req.body.length,
              internal,
              storageKey,
              sha256: crypto
                .createHash("sha256")
                .update(req.body)
                .digest("hex"),
              uploadedBy: req.user._id,
            },
          ],
          { session },
        );
        return record;
      });
      res
        .status(201)
        .json({ _id: attachment._id, name, mime, size: attachment.size });
    } catch (error) {
      await unlink(path.join(directory(), storageKey));
      throw error;
    }
  }),
);
router.get(
  "/:workspaceId/tickets/:ticketId/attachments",
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId);
    res.json(
      await Attachment.find({
        workspace: req.workspace._id,
        ticket: ticket._id,
        ...(req.member.role === "customer" ? { internal: false } : {}),
      }).lean(),
    );
  }),
);
router.get(
  "/:workspaceId/tickets/:ticketId/attachments/:attachmentId",
  wrap(async (req, res) => {
    const ticket = await ticketAccess(req, req.params.ticketId),
      attachment = await Attachment.findOne({
        _id: objectId(req.params.attachmentId),
        workspace: req.workspace._id,
        ticket: ticket._id,
      }).select("+storageKey");
    if (!attachment || (attachment.internal && req.member.role === "customer"))
      throw fail("Attachment not found", 404);
    res
      .set("X-Content-Type-Options", "nosniff")
      .type(attachment.mime)
      .attachment(attachment.name)
      .sendFile(path.join(directory(), attachment.storageKey));
  }),
);
export default router;

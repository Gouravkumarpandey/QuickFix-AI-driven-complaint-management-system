import crypto from "node:crypto";
import { promisify } from "node:util";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
const MAGIC = Buffer.from("QFBACKUP1");
const key = async (pass, salt) => promisify(crypto.scrypt)(pass, salt, 32);
export async function sealBackup(input, output, pass) {
  const salt = crypto.randomBytes(16),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", await key(pass, salt), iv),
    header = Buffer.concat([MAGIC, salt, iv]);
  const handle = await open(output, "wx", 0o600);
  try {
    await handle.write(header);
    await handle.close();
    await pipeline(
      createReadStream(input),
      cipher,
      createWriteStream(output, { flags: "a", mode: 0o600 }),
    );
    const tail = await open(output, "a");
    try {
      await tail.write(cipher.getAuthTag());
    } finally {
      await tail.close();
    }
  } catch (e) {
    await handle.close().catch(() => {});
    await unlink(output).catch(() => {});
    throw e;
  }
}
export async function unsealBackup(input, output, pass) {
  const info = await stat(input),
    headerSize = MAGIC.length + 28;
  if (info.size < headerSize + 16) throw new Error("Invalid backup envelope");
  const h = await open(input, "r"),
    header = Buffer.alloc(headerSize),
    tag = Buffer.alloc(16);
  try {
    await h.read(header, 0, headerSize, 0);
    await h.read(tag, 0, 16, info.size - 16);
  } finally {
    await h.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error("Invalid backup format");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    await key(pass, header.subarray(MAGIC.length, MAGIC.length + 16)),
    header.subarray(MAGIC.length + 16),
  );
  decipher.setAuthTag(tag);
  const partial = output + "." + crypto.randomUUID() + ".partial";
  try {
    await pipeline(
      createReadStream(input, { start: headerSize, end: info.size - 17 }),
      decipher,
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
    );
    const target = await open(output, "wx", 0o600);
    await target.close();
    await rename(partial, output);
  } catch (e) {
    await unlink(partial).catch(() => {});
    throw e;
  }
}

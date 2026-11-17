// Run only in a planned maintenance window with API mutations and the worker stopped.
import { mkdtemp, writeFile, mkdir, rm, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { sealBackup } from "./backupCrypto.mjs";
import os from "node:os";
import path from "node:path";
if (
  process.env.BACKUP_QUIESCED !== "1" ||
  !process.env.MONGODB_URI ||
  !process.env.BACKUP_PASSPHRASE ||
  !process.env.PRIVATE_UPLOAD_DIR ||
  !process.env.BACKUP_DIR
)
  throw new Error(
    "Set BACKUP_QUIESCED=1, MONGODB_URI, BACKUP_PASSPHRASE, PRIVATE_UPLOAD_DIR and BACKUP_DIR. Stop mutations and the worker first.",
  );
const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              cmd + " failed (details suppressed to protect credentials)",
            ),
          ),
    );
  });
const temp = await mkdtemp(path.join(os.tmpdir(), "quickfix-backup-"));
try {
  await mkdir(process.env.BACKUP_DIR, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(temp, "mongo.yml"),
    "uri: " + JSON.stringify(process.env.MONGODB_URI) + "\n",
    { mode: 0o600 },
  );
  await run("mongodump", [
    "--config",
    path.join(temp, "mongo.yml"),
    "--archive=" + path.join(temp, "database.archive"),
    "--gzip",
  ]);
  await run("tar", [
    "-cf",
    path.join(temp, "private-files.tar"),
    "-C",
    process.env.PRIVATE_UPLOAD_DIR,
    ".",
  ]);
  await writeFile(
    path.join(temp, "manifest.json"),
    JSON.stringify({
      version: 1,
      createdAt: new Date(),
      database: "database.archive (mongorestore --gzip --archive)",
      files: "private-files.tar",
      encryptionKey:
        "Preserve INTEGRATION_ENCRYPTION_KEY separately in the secret manager; it is intentionally not in this archive.",
    }),
  );
  await run("tar", [
    "-cf",
    path.join(temp, "snapshot.tar"),
    "-C",
    temp,
    "database.archive",
    "private-files.tar",
    "manifest.json",
  ]);
  const target = path.join(
    process.env.BACKUP_DIR,
    "quickfix-" + new Date().toISOString().replace(/[:.]/g, "-") + ".tar.enc",
  );
  await sealBackup(
    path.join(temp, "snapshot.tar"),
    target + ".partial",
    process.env.BACKUP_PASSPHRASE,
  );
  await rename(target + ".partial", target);
  console.log("Created encrypted backup:", target);
} finally {
  await rm(temp, { recursive: true, force: true });
}

import { unsealBackup } from "./backupCrypto.mjs";
const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.BACKUP_PASSPHRASE)
  throw new Error(
    "Usage: BACKUP_PASSPHRASE=... node scripts/decryptHelpdeskBackup.mjs input.tar.enc output.tar",
  );
await unsealBackup(input, output, process.env.BACKUP_PASSPHRASE);
console.log(
  "Authenticated backup decrypted. Restore only to an isolated database first:",
  output,
);

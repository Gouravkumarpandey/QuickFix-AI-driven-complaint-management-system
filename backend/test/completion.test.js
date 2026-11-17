import test from "node:test";
import assert from "node:assert/strict";
import { cleanHTML, plainHTML } from "../src/helpdesk/richText.js";
import { mimeOf } from "../src/helpdesk/attachments.js";
import { inboundTwiML } from "../src/helpdesk/voicePlus.js";
import { queryVectors, upsertVectors } from "../src/helpdesk/vectorStore.js";
import { encrypt } from "../src/helpdesk/connectors.js";
import { metaTemplates } from "../src/helpdesk/whatsappPlus.js";
process.env.INTEGRATION_ENCRYPTION_KEY = "4".repeat(64);
test("formatted email removes active content and unsafe URLs while retaining text and lists", () => {
  const html = cleanHTML(
    '<p onclick="alert(1)">Hello <strong>team</strong></p><script>bad()</script><img src=x onerror=bad()><a href="javascript:alert(1)">bad link</a><a href="https://example.com">safe</a><ul><li>One</li></ul>',
  );
  assert.ok(html.includes("<strong>team</strong>"));
  assert.ok(!/script|onclick|onerror|javascript:|<img/.test(html));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(plainHTML(html).includes("Hello team"));
});
test("audio and video uploads are recognized by signatures rather than a filename", () => {
  assert.equal(mimeOf(Buffer.from("ID3fixture")), "audio/mpeg");
  assert.equal(mimeOf(Buffer.from("OggSfixture")), "audio/ogg");
  assert.equal(mimeOf(Buffer.from("RIFF0000WAVEfixture")), "audio/wav");
  assert.equal(mimeOf(Buffer.from("0000ftypmp42fixture")), "video/mp4");
  assert.throws(() => mimeOf(Buffer.from("MZmalware.mp4")));
});
test("IVR supports only configured digits and announces recording before dialing", () => {
  const c = {
    _id: "c".repeat(24),
    config: {
      phoneNumber: "+919000000001",
      forwardTo: "+919000000002",
      voice: {
        recordCalls: true,
        recordingNotice: "This call is recorded.",
        ivr: {
          greeting: "Press 1 for delivery",
          routes: [
            { digit: "1", label: "Delivery", destination: "+919000000003" },
          ],
        },
      },
    },
  };
  const menu = inboundTwiML(c);
  assert.ok(menu.includes("<Gather"));
  assert.ok(menu.indexOf("recorded") < menu.indexOf("<Gather"));
  const route = inboundTwiML(c, "1");
  assert.ok(route.includes("+919000000003"));
  assert.ok(route.includes("record-from-answer-dual"));
  const invalid = inboundTwiML(c, "9");
  assert.ok(invalid.includes("Invalid selection"));
  assert.ok(!invalid.includes("<Dial"));
});
test("vector queries and writes bind every request to a workspace and model", async () => {
  process.env.QDRANT_URL = "https://vector.example.invalid";
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(
      JSON.stringify({
        result: {
          points: [
            {
              score: 0.9,
              payload: {
                workspace: "a".repeat(24),
                model: "fixture",
                rowId: "b".repeat(24),
              },
            },
            {
              score: 1,
              payload: {
                workspace: "OTHER",
                model: "fixture",
                rowId: "c".repeat(24),
              },
            },
          ],
        },
      }),
      { status: 200 },
    );
  };
  try {
    const found = await queryVectors(
      "a".repeat(24),
      "fixture",
      [1, 0],
      fetcher,
    );
    assert.equal(found.length, 1);
    assert.deepEqual(calls[0].body.filter.must, [
      { key: "workspace", match: { value: "a".repeat(24) } },
      { key: "model", match: { value: "fixture" } },
    ]);
    await upsertVectors(
      [
        {
          _id: "b".repeat(24),
          workspace: "a".repeat(24),
          model: "fixture",
          vector: [1, 0],
        },
      ],
      fetcher,
    );
    assert.equal(calls[1].body.points[0].payload.workspace, "a".repeat(24));
    assert.match(calls[1].body.points[0].id, /^[a-f0-9-]{36}$/);
  } finally {
    delete process.env.QDRANT_URL;
  }
});
test("template management uses the configured business account and bounded pagination, not provider next URLs", async () => {
  const c = {
    token: encrypt("secret-fixture"),
    config: { businessAccountId: "1234567890" },
  };
  let request;
  const response = await metaTemplates(
    c,
    "GET",
    undefined,
    async (url, options) => {
      request = { url: String(url), options };
      return new Response(
        JSON.stringify({
          data: [{ name: "approved", status: "APPROVED" }],
          paging: {
            cursors: { after: "cursor" },
            next: "https://attacker.invalid",
          },
        }),
        { status: 200 },
      );
    },
  );
  assert.ok(request.url.includes("/1234567890/message_templates"));
  assert.equal(response.after, "cursor");
  assert.equal(response.templates.length, 1);
});
test("backups authenticate ciphertext and reject tampering before publishing decrypted data", async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path"),
    { sealBackup, unsealBackup } = await import("../scripts/backupCrypto.mjs");
  const dir = await mkdtemp(path.join(tmpdir(), "quickfix-backup-test-"));
  try {
    await writeFile(path.join(dir, "plain"), "private fixture snapshot");
    await sealBackup(
      path.join(dir, "plain"),
      path.join(dir, "sealed"),
      "fixture-passphrase",
    );
    await unsealBackup(
      path.join(dir, "sealed"),
      path.join(dir, "restored"),
      "fixture-passphrase",
    );
    assert.equal(
      await readFile(path.join(dir, "restored"), "utf8"),
      "private fixture snapshot",
    );
    const data = await readFile(path.join(dir, "sealed"));
    data[data.length - 17] ^= 1;
    await writeFile(path.join(dir, "tampered"), data);
    await assert.rejects(() =>
      unsealBackup(
        path.join(dir, "tampered"),
        path.join(dir, "rejected"),
        "fixture-passphrase",
      ),
    );
    await assert.rejects(() => readFile(path.join(dir, "rejected")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

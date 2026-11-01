import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { dueAt, transitionSLA } from "../src/helpdesk/sla.js";
import { signatureOK, encrypt, decrypt } from "../src/helpdesk/connectors.js";
import { validateFields } from "../src/helpdesk/validation.js";
import { mimeOf } from "../src/helpdesk/attachments.js";
const settings = {
  timezone: "Asia/Kolkata",
  businessHours: {
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "18:00",
    holidays: ["2026-11-02"],
  },
  pauseStatuses: ["Waiting on customer"],
  sla: { businessHours: true },
};
test("business-hour SLA skips weekends and holidays in the configured timezone", () => {
  assert.equal(
    dueAt(new Date("2026-10-30T12:00:00Z"), 60, settings).toISOString(),
    "2026-11-03T04:00:00.000Z",
  );
});
test("pausing an SLA preserves remaining business minutes instead of counting waiting time", () => {
  const ticket = {
    sla: {
      firstDue: new Date("2026-11-03T05:30:00Z"),
      resolutionDue: new Date("2026-11-03T06:30:00Z"),
    },
  };
  transitionSLA(
    ticket,
    "Waiting on customer",
    settings,
    new Date("2026-11-03T04:30:00Z"),
  );
  transitionSLA(
    ticket,
    "In Progress",
    settings,
    new Date("2026-11-04T04:30:00Z"),
  );
  assert.equal(ticket.sla.firstDue.toISOString(), "2026-11-04T05:30:00.000Z");
});
test("channel signatures require exact raw bytes and encryption does not expose tokens", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = "1".repeat(64);
  const secret = "test-channel-secret",
    body = Buffer.from('{"text":"hello"}'),
    sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(signatureOK(secret, body, sig), true);
  assert.equal(
    signatureOK(secret, Buffer.from('{ "text":"hello" }'), sig),
    false,
  );
  assert.equal(signatureOK(secret, body, "no"), false);
  const encoded = encrypt(secret);
  assert.ok(!encoded.includes(secret));
  assert.equal(decrypt(encoded), secret);
});
test("custom ticket fields reject unknown keys, invalid options and missing required values", () => {
  const definitions = [
    { key: "order", type: "text", required: true },
    { key: "reason", type: "dropdown", options: ["Delivery", "Refund"] },
  ];
  assert.throws(() => validateFields(definitions, {}));
  assert.throws(() =>
    validateFields(definitions, { order: "123", admin: true }),
  );
  assert.throws(() =>
    validateFields(definitions, { order: "123", reason: "Anything" }),
  );
  assert.deepEqual(
    validateFields(definitions, { order: "123", reason: "Delivery" }),
    { order: "123", reason: "Delivery" },
  );
});
test("attachments reject executable payloads and detect allowed file signatures", () => {
  assert.throws(() => mimeOf(Buffer.from("<script>alert(1)</script>")));
  assert.equal(mimeOf(Buffer.from("%PDF-1.4\nfixture")), "application/pdf");
});
test("outgoing webhook URLs and resolved IPs reject private networks and embedded credentials", async () => {
  const { webhookURL, publicIPv4 } = await import(
    "../src/helpdesk/webhooks.js"
  );
  for (const address of [
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest",
    "https://user:pass@example.com/hook",
    "http://example.com/hook",
    "https://[::1]/hook",
    "https://example.com:8080/hook",
  ])
    assert.throws(() => webhookURL(address));
  for (const address of [
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicIPv4(address), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
});

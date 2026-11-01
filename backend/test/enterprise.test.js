import test from "node:test";
import assert from "node:assert/strict";
import { base32, totp, matchTotp } from "../src/helpdesk/security.js";
import { amounts, secureHex } from "../src/helpdesk/indiaBilling.js";
import { cosine } from "../src/helpdesk/semantic.js";
import { entitlement } from "../src/helpdesk/entitlements.js";
import crypto from "node:crypto";
test("TOTP matches the RFC 6238 SHA-1 vector and rejects used or malformed codes", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 1), "287082");
  assert.equal(matchTotp(secret, "287082", 0, 59000), 1);
  assert.equal(matchTotp(secret, "287082", 1, 59000), null);
  assert.equal(matchTotp(secret, "bad", 0, 59000), null);
});
test("INR tax components sum exactly and payment signatures bind both provider IDs", () => {
  for (const n of [1, 999, 100001]) {
    const local = amounts(n, 1800, "20", "20"),
      remote = amounts(n, 1800, "20", "19");
    assert.equal(local.cgst + local.sgst, local.tax);
    assert.equal(remote.igst, remote.tax);
    assert.equal(local.total, n + local.tax);
  }
  const sig = crypto
    .createHmac("sha256", "secret")
    .update("order|pay")
    .digest("hex");
  assert.ok(secureHex("secret", "order|pay", sig));
  assert.ok(!secureHex("secret", "another-order|pay", sig));
});
test("semantic similarity handles mismatched vectors and empty norms safely", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 0]), 0);
  assert.equal(cosine([1], [1, 0]), 0);
});
test("expired paid features revert to Free independently of worker cleanup", () => {
  const expired = {
    billing: {
      plan: "Premium",
      seats: 100,
      status: "active",
      expiresAt: new Date(0),
    },
  };
  assert.equal(entitlement(expired).plan, "Free");
  assert.equal(entitlement(expired).seats, 2);
  assert.ok(!entitlement(expired).features.includes("sso"));
});

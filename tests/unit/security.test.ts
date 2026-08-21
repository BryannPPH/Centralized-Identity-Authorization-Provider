import assert from "node:assert/strict";
import { test } from "node:test";
import { hashSecret } from "../../auth-provider/control-panel/src/crypto.js";
import { generateToken, hashToken, verifySecret } from "../../auth-provider/server/src/crypto.js";
import { decryptSecret, encryptSecret } from "../../auth-provider/shared/encryption.js";
import { createCodeChallenge, validatePkce } from "../../shared/pkce.js";
import { hasAllowedGroup } from "../../auth-provider/shared/policy.js";
import { generateTotpCode, verifyTotpCode } from "../../auth-provider/shared/totp.js";

test("hashSecret creates scrypt hashes that verify only the original secret", async () => {
  const samplePassword = "sample-password";
  const hash = await hashSecret(samplePassword);

  assert.match(hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifySecret(samplePassword, hash), true);
  assert.equal(await verifySecret("wrong-password", hash), false);
  assert.equal(await verifySecret(samplePassword, "bad-format"), false);
});

test("token hashing is deterministic and generated tokens are URL-safe", () => {
  const token = generateToken();

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(hashToken("same-token"), hashToken("same-token"));
  assert.notEqual(hashToken("same-token"), hashToken("other-token"));
});

test("PKCE S256 challenge validates the matching verifier only", () => {
  const verifier = "test-verifier-123";
  const challenge = createCodeChallenge(verifier);

  assert.equal(validatePkce(verifier, challenge, "S256"), true);
  assert.equal(validatePkce("wrong-verifier", challenge, "S256"), false);
  assert.equal(validatePkce(verifier, challenge, "plain"), false);
});

test("policy evaluator allows access only when user group intersects policy groups", () => {
  assert.equal(hasAllowedGroup(["group-a"], ["group-a", "group-b"]), true);
  assert.equal(hasAllowedGroup(["group-a"], ["group-b"]), false);
  assert.equal(hasAllowedGroup([], ["group-a"]), false);
  assert.equal(hasAllowedGroup(["group-a"], []), false);
});

test("TOTP follows RFC 6238 test vector and rejects invalid codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const now = new Date(59 * 1000);

  assert.equal(generateTotpCode(secret, now, 30, 8), "94287082");
  assert.equal(verifyTotpCode(secret, generateTotpCode(secret, now), now), true);
  assert.equal(verifyTotpCode(secret, "000000", now), false);
  assert.equal(verifyTotpCode(secret, "not-code", now), false);
});

test("MFA secret encryption round-trips without storing plaintext", () => {
  process.env.MFA_SECRET_ENCRYPTION_KEY = "unit-test-key";

  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP");

  assert.notEqual(encrypted, "JBSWY3DPEHPK3PXP");
  assert.equal(decryptSecret(encrypted), "JBSWY3DPEHPK3PXP");
});

import { createHash, timingSafeEqual } from "node:crypto";

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function validatePkce(
  verifier: string,
  challenge: string,
  method: string
): boolean {
  if (method !== "S256") {
    return false;
  }

  return safeEqualString(createCodeChallenge(verifier), challenge);
}

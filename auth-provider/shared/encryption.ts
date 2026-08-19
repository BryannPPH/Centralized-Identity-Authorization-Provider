import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function getEncryptionKey(): Buffer {
  const rawKey = process.env.MFA_SECRET_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error("MFA_SECRET_ENCRYPTION_KEY is required");
  }

  return createHash("sha256").update(rawKey).digest();
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecret(value: string): string {
  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== VERSION || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted secret format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

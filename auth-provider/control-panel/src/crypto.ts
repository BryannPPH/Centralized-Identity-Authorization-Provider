import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(value, salt, 64)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}


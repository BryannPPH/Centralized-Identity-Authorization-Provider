import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer: Buffer): string {
  let bits = "";
  let output = "";

  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }

  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += ALPHABET[Number.parseInt(chunk, 2)];
  }

  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.toUpperCase().replaceAll("=", "").replace(/\s+/g, "");
  let bits = "";

  for (const character of normalized) {
    const index = ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error("Invalid TOTP secret");
    }

    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function generateTotpCode(
  secret: string,
  now = new Date(),
  stepSeconds = DEFAULT_STEP_SECONDS,
  digits = DEFAULT_DIGITS
): string {
  const counter = Math.floor(now.getTime() / 1000 / stepSeconds);

  return hotp(base32Decode(secret), counter, digits);
}

export function verifyTotpCode(
  secret: string,
  code: string,
  now = new Date(),
  window = 1
): boolean {
  if (!/^\d{6}$/.test(code)) {
    return false;
  }

  for (let offset = -window; offset <= window; offset += 1) {
    const expected = generateTotpCode(
      secret,
      new Date(now.getTime() + offset * DEFAULT_STEP_SECONDS * 1000)
    );
    const expectedBuffer = Buffer.from(expected);
    const codeBuffer = Buffer.from(code);

    if (
      expectedBuffer.length === codeBuffer.length &&
      timingSafeEqual(expectedBuffer, codeBuffer)
    ) {
      return true;
    }
  }

  return false;
}

export function createTotpUri(options: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.accountName}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: "SHA1",
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SECONDS)
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

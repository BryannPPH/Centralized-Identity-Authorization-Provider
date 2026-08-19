export const CENTRAL_SESSION_COOKIE = "central_session";
export const MFA_CHALLENGE_COOKIE = "mfa_challenge";

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

type SessionCookieOptions = {
  maxAgeSeconds: number;
  secure: boolean;
};

export function serializeSessionCookie(
  token: string,
  options: SessionCookieOptions
): string {
  const parts = [
    `${CENTRAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${options.maxAgeSeconds}`
  ];

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${CENTRAL_SESSION_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function serializeMfaChallengeCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  const parts = [
    `${MFA_CHALLENGE_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function clearMfaChallengeCookie(secure: boolean): string {
  const parts = [
    `${MFA_CHALLENGE_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0"
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

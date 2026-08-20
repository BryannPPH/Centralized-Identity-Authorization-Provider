import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AuditResult,
  MfaChallengeStatus,
  Prisma,
  SessionStatus,
  TokenStatus,
  UserStatus
} from "../../../generated/prisma/client.js";
import {
  createRevocationEvent,
  getActiveApplicationIds,
  revokeUserCentralSessions
} from "../../shared/events.js";
import { decryptSecret, encryptSecret } from "../../shared/encryption.js";
import {
  createTotpUri,
  generateTotpSecret,
  verifyTotpCode
} from "../../shared/totp.js";
import {
  CENTRAL_SESSION_COOKIE,
  MFA_CHALLENGE_COOKIE,
  clearMfaChallengeCookie,
  clearSessionCookie,
  parseCookie,
  serializeMfaChallengeCookie,
  serializeSessionCookie
} from "./cookies.js";
import { generateToken, hashSecret, hashToken, verifySecret } from "./crypto.js";
import { prisma } from "./db.js";
import { HttpError, assertObjectBody, requireString } from "./http.js";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const MFA_CHALLENGE_MAX_AGE_SECONDS = 5 * 60;
const MFA_ISSUER = "Centralized Identity Provider";

const LOGIN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Auth Provider Login</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #1f2933;
        --muted: #667085;
        --line: #d9dee7;
        --accent: #1f7a5a;
        --danger: #b42318;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: var(--bg);
        color: var(--text);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(100% - 32px, 380px);
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 22px;
      }

      h1 {
        margin: 0 0 16px;
        font-size: 20px;
      }

      label {
        display: block;
        margin: 12px 0 6px;
        color: var(--muted);
        font-weight: 700;
      }

      input,
      button {
        width: 100%;
        min-height: 40px;
        border-radius: 6px;
        font: inherit;
      }

      input {
        border: 1px solid var(--line);
        padding: 8px 10px;
      }

      button {
        margin-top: 16px;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: #ffffff;
        cursor: pointer;
        font-weight: 700;
      }

      #message {
        min-height: 22px;
        margin-top: 12px;
        color: var(--danger);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Auth Provider Login</h1>
      <form id="login-form">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="submit">Login</button>
      </form>
      <form id="mfa-form" hidden>
        <label for="code">Authenticator code</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
        <button type="submit">Verify</button>
      </form>
      <div id="message"></div>
    </main>
    <script>
      const form = document.getElementById("login-form");
      const mfaForm = document.getElementById("mfa-form");
      const message = document.getElementById("message");
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");

      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        message.textContent = "Logging in...";
        const response = await fetch("/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: form.email.value,
            password: form.password.value
          })
        });
        const data = await response.json();
        if (!response.ok) {
          message.textContent = data.error ? data.error.message : "Login gagal";
          return;
        }
        if (data.mfaRequired) {
          form.hidden = true;
          mfaForm.hidden = false;
          message.style.color = "#667085";
          message.textContent = "Masukkan kode authenticator";
          mfaForm.code.focus();
          return;
        }
        if (returnTo && returnTo.startsWith("/")) {
          window.location.href = returnTo;
          return;
        }
        message.style.color = "#1f7a5a";
        message.textContent = "Login berhasil";
      });

      mfaForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        message.textContent = "Verifying...";
        const response = await fetch("/login/mfa", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: mfaForm.code.value
          })
        });
        const data = await response.json();
        if (!response.ok) {
          message.style.color = "#b42318";
          message.textContent = data.error ? data.error.message : "Kode MFA tidak valid";
          return;
        }
        if (returnTo && returnTo.startsWith("/")) {
          window.location.href = returnTo;
          return;
        }
        message.style.color = "#1f7a5a";
        message.textContent = "Login berhasil";
      });
    </script>
  </body>
</html>`;

type CentralSession = {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string;
    email: string;
    status: UserStatus;
    groups: Array<{
      group: {
        id: string;
        name: string;
      };
    }>;
  };
};

function isSecureCookieEnabled(): boolean {
  return process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
}

function requireInternalToken(request: FastifyRequest): void {
  const expectedToken = process.env.INTERNAL_LOGOUT_TOKEN;

  if (!expectedToken || request.headers["x-internal-token"] !== expectedToken) {
    throw new HttpError(401, "UNAUTHORIZED", "Internal token tidak valid");
  }
}

function getSessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

function getMfaChallengeExpiresAt(): Date {
  return new Date(Date.now() + MFA_CHALLENGE_MAX_AGE_SECONDS * 1000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function authHomeHtml(session: CentralSession | null): string {
  const content = session
    ? `<h1>Auth Provider</h1>
      <p class="muted">Central session aktif.</p>
      <dl>
        <dt>Name</dt><dd>${escapeHtml(session.user.name)}</dd>
        <dt>Email</dt><dd>${escapeHtml(session.user.email)}</dd>
        <dt>Groups</dt><dd>${escapeHtml(session.user.groups.map((entry) => entry.group.name).join(", ") || "-")}</dd>
        <dt>Session</dt><dd>${escapeHtml(session.id)}</dd>
      </dl>
      <form id="logout-form">
        <button type="submit" class="danger">Logout SSO</button>
      </form>
      <a class="button secondary" href="/password">Change Password</a>
      <a class="button secondary" href="/mfa/enroll">MFA Enrollment</a>
      <p id="message"></p>
      <script>
        const form = document.getElementById("logout-form");
        const message = document.getElementById("message");
        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          message.textContent = "Logging out...";
          const response = await fetch("/logout-sso", { method: "POST" });
          if (!response.ok) {
            message.textContent = "Logout SSO gagal";
            return;
          }
          window.location.href = "/";
        });
      </script>`
    : `<h1>Auth Provider</h1>
      <p class="muted">Central session belum aktif.</p>
      <a class="button" href="/login">Login</a>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Auth Provider</title>
    <style>
      :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --text: #1f2933; --muted: #667085; --line: #d9dee7; --accent: #1f7a5a; --danger: #b42318; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100% - 32px, 480px); border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 22px; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      dl { display: grid; grid-template-columns: 96px 1fr; gap: 8px 12px; margin: 18px 0; }
      dt { color: var(--muted); font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      .muted { color: var(--muted); }
      .button, button { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; padding: 0 14px; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
      .secondary { margin-top: 10px; border-color: var(--line); background: #fff; color: var(--text); }
      .danger { border-color: var(--danger); background: var(--danger); }
      #message { min-height: 22px; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>${content}</main>
  </body>
</html>`;
}

function passwordChangeHtml(session: CentralSession): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Change Password</title>
    <style>
      :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --text: #1f2933; --muted: #667085; --line: #d9dee7; --accent: #1f7a5a; --danger: #b42318; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100% - 32px, 420px); border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 22px; }
      h1 { margin: 0 0 6px; font-size: 20px; }
      p { margin: 0 0 16px; }
      label { display: block; margin: 12px 0 6px; color: var(--muted); font-weight: 700; }
      input, button, a.button { width: 100%; min-height: 40px; border-radius: 6px; font: inherit; }
      input { border: 1px solid var(--line); padding: 8px 10px; }
      button, a.button { display: inline-flex; align-items: center; justify-content: center; margin-top: 16px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; font-weight: 700; text-decoration: none; }
      a.secondary { margin-top: 10px; border-color: var(--line); background: #fff; color: var(--text); }
      .muted { color: var(--muted); }
      #message { min-height: 22px; margin-top: 12px; color: var(--danger); }
    </style>
  </head>
  <body>
    <main>
      <h1>Change Password</h1>
      <p class="muted">${escapeHtml(session.user.email)}</p>
      <form id="password-form">
        <label for="currentPassword">Current password</label>
        <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
        <label for="newPassword">New password</label>
        <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required>
        <label for="confirmPassword">Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required>
        <button type="submit">Save Password</button>
      </form>
      <a class="button secondary" href="/">Cancel</a>
      <div id="message"></div>
    </main>
    <script>
      const form = document.getElementById("password-form");
      const message = document.getElementById("message");
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        message.style.color = "#667085";
        message.textContent = "Saving...";
        const response = await fetch("/password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentPassword: form.currentPassword.value,
            newPassword: form.newPassword.value,
            confirmPassword: form.confirmPassword.value
          })
        });
        const data = await response.json();
        if (!response.ok) {
          message.style.color = "#b42318";
          message.textContent = data.error ? data.error.message : "Password gagal diubah";
          return;
        }
        message.style.color = "#1f7a5a";
        message.textContent = "Password berhasil diubah. Semua session dicabut.";
        window.setTimeout(function () {
          window.location.href = "/";
        }, 900);
      });
    </script>
  </body>
</html>`;
}

function mfaEnrollmentHtml(secret: string, otpauthUri: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MFA Enrollment</title>
    <style>
      :root { color-scheme: light; --bg: #f6f7f9; --panel: #fff; --text: #1f2933; --muted: #667085; --line: #d9dee7; --accent: #1f7a5a; --danger: #b42318; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100% - 32px, 520px); border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 22px; }
      h1 { margin: 0 0 16px; font-size: 20px; }
      label { display: block; margin: 12px 0 6px; color: var(--muted); font-weight: 700; }
      input, button { width: 100%; min-height: 40px; border-radius: 6px; font: inherit; }
      input { border: 1px solid var(--line); padding: 8px 10px; }
      button { margin-top: 16px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; font-weight: 700; }
      code { display: block; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 6px; padding: 10px; background: #f9fafb; }
      .muted { color: var(--muted); }
      #message { min-height: 22px; margin-top: 12px; color: var(--danger); }
    </style>
  </head>
  <body>
    <main>
      <h1>MFA Enrollment</h1>
      <p class="muted">Tambahkan secret ini ke aplikasi authenticator, lalu masukkan kode 6 digit.</p>
      <label>Manual secret</label>
      <code id="totp-secret">${escapeHtml(secret)}</code>
      <label>Authenticator URI</label>
      <code>${escapeHtml(otpauthUri)}</code>
      <form id="mfa-enroll-form">
        <label for="code">Authenticator code</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
        <button type="submit">Enable MFA</button>
      </form>
      <div id="message"></div>
    </main>
    <script>
      const form = document.getElementById("mfa-enroll-form");
      const message = document.getElementById("message");
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        message.textContent = "Verifying...";
        const response = await fetch("/mfa/enroll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: form.code.value })
        });
        const data = await response.json();
        if (!response.ok) {
          message.style.color = "#b42318";
          message.textContent = data.error ? data.error.message : "Enrollment gagal";
          return;
        }
        message.style.color = "#1f7a5a";
        message.textContent = "MFA aktif";
      });
    </script>
  </body>
</html>`;
}

async function writeAudit(
  request: FastifyRequest,
  eventType: string,
  result: AuditResult,
  metadata: Prisma.InputJsonValue,
  userId?: string
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      eventType,
      userId,
      result,
      metadata,
      ipAddress: request.ip
    }
  });
}

async function createCentralSession(
  request: FastifyRequest,
  user: { id: string; name: string; email: string; status: UserStatus }
): Promise<{
  token: string;
  session: {
    id: string;
    expiresAt: Date;
  };
}> {
  const token = generateToken();
  const expiresAt = getSessionExpiresAt();
  const session = await prisma.ssoSession.create({
    data: {
      userId: user.id,
      sessionTokenHash: hashToken(token),
      status: SessionStatus.ACTIVE,
      expiresAt,
      lastActivityAt: new Date(),
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"]
    },
    select: {
      id: true,
      expiresAt: true
    }
  });

  await writeAudit(
    request,
    "LoginSuccess",
    AuditResult.SUCCESS,
    { sessionId: session.id, email: user.email },
    user.id
  );

  return {
    token,
    session
  };
}

export async function getCentralSession(
  request: FastifyRequest
): Promise<CentralSession | null> {
  const token = parseCookie(request.headers.cookie, CENTRAL_SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const session = await prisma.ssoSession.findFirst({
    where: {
      sessionTokenHash: hashToken(token),
      status: SessionStatus.ACTIVE,
      revokedAt: null,
      expiresAt: {
        gt: new Date()
      },
      user: {
        status: UserStatus.ACTIVE
      }
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          groups: {
            select: {
              group: {
                select: {
                  id: true,
                  name: true
                }
              }
            },
            orderBy: {
              group: {
                name: "asc"
              }
            }
          }
        }
      }
    }
  });

  if (!session) {
    return null;
  }

  await prisma.ssoSession.update({
    where: {
      id: session.id
    },
    data: {
      lastActivityAt: new Date()
    }
  });

  return session;
}

async function requireCentralSession(request: FastifyRequest): Promise<CentralSession> {
  const session = await getCentralSession(request);

  if (!session) {
    throw new HttpError(401, "UNAUTHENTICATED", "Central session tidak valid");
  }

  return session;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const session = await getCentralSession(request);

    reply.type("text/html; charset=utf-8");
    return authHomeHtml(session);
  });

  app.get("/login", async (_, reply) => {
    reply.type("text/html; charset=utf-8");
    return LOGIN_HTML;
  });

  app.get("/password", async (request, reply) => {
    const session = await getCentralSession(request);

    if (!session) {
      reply.redirect("/login?returnTo=/password");
      return;
    }

    reply.type("text/html; charset=utf-8");
    return passwordChangeHtml(session);
  });

  app.post("/password", async (request, reply) => {
    const session = await requireCentralSession(request);
    const body = assertObjectBody(request.body);
    const currentPassword = requireString(body, "currentPassword");
    const newPassword = requireString(body, "newPassword");
    const confirmPassword = requireString(body, "confirmPassword");

    if (newPassword !== confirmPassword) {
      throw new HttpError(400, "INVALID_BODY", "Konfirmasi password tidak sama");
    }

    const user = await prisma.user.findUnique({
      where: {
        id: session.userId
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true
      }
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new HttpError(401, "UNAUTHENTICATED", "Central session tidak valid");
    }

    if (!(await verifySecret(currentPassword, user.passwordHash))) {
      await writeAudit(
        request,
        "PasswordChangeFailed",
        AuditResult.FAILED,
        { reason: "invalid_current_password" },
        user.id
      );
      throw new HttpError(401, "INVALID_CREDENTIALS", "Password saat ini tidak valid");
    }

    const passwordHash = await hashSecret(newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: user.id
        },
        data: {
          passwordHash
        }
      });

      const [targetApplicationIds, revokedSessions] = await Promise.all([
        getActiveApplicationIds(tx),
        revokeUserCentralSessions(tx, user.id, "password_changed")
      ]);

      for (const revokedSession of revokedSessions) {
        await createRevocationEvent(tx, {
          eventType: "PasswordChanged",
          userId: user.id,
          centralSessionId: revokedSession.id,
          payload: {
            reason: "password_changed",
            userId: user.id,
            centralSessionId: revokedSession.id
          },
          targetApplicationIds
        });
      }

      await tx.auditLog.create({
        data: {
          eventType: "PasswordChanged",
          userId: user.id,
          result: AuditResult.SUCCESS,
          metadata: {
            revokedSessions: revokedSessions.length
          },
          ipAddress: request.ip
        }
      });
    });

    reply.header("set-cookie", clearSessionCookie(isSecureCookieEnabled()));

    return {
      status: "ok"
    };
  });

  app.post("/login", async (request, reply) => {
    const body = assertObjectBody(request.body);
    const email = requireString(body, "email").toLowerCase();
    const password = requireString(body, "password");
    const user = await prisma.user.findUnique({
      where: {
        email
      },
      select: {
        id: true,
        name: true,
        email: true,
        passwordHash: true,
        status: true,
        mfaTotpCredential: {
          select: {
            enabledAt: true
          }
        }
      }
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      await writeAudit(
        request,
        "LoginFailed",
        AuditResult.FAILED,
        { email, reason: user ? "inactive_user" : "invalid_credentials" },
        user?.id
      );
      throw new HttpError(401, "INVALID_CREDENTIALS", "Email atau password tidak valid");
    }

    const isPasswordValid = await verifySecret(password, user.passwordHash);

    if (!isPasswordValid) {
      await writeAudit(
        request,
        "LoginFailed",
        AuditResult.FAILED,
        { email, reason: "invalid_credentials" },
        user.id
      );
      throw new HttpError(401, "INVALID_CREDENTIALS", "Email atau password tidak valid");
    }

    if (user.mfaTotpCredential?.enabledAt) {
      const challengeToken = generateToken();
      const challenge = await prisma.mfaChallenge.create({
        data: {
          userId: user.id,
          challengeTokenHash: hashToken(challengeToken),
          status: MfaChallengeStatus.PENDING,
          expiresAt: getMfaChallengeExpiresAt(),
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"]
        },
        select: {
          expiresAt: true
        }
      });

      reply.header(
        "set-cookie",
        serializeMfaChallengeCookie(
          challengeToken,
          MFA_CHALLENGE_MAX_AGE_SECONDS,
          isSecureCookieEnabled()
        )
      );

      return {
        mfaRequired: true,
        challenge: {
          expiresAt: challenge.expiresAt
        },
        user: {
          id: user.id,
          email: user.email
        }
      };
    }

    const { token, session } = await createCentralSession(request, user);

    reply.header(
      "set-cookie",
      serializeSessionCookie(token, {
        maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
        secure: isSecureCookieEnabled()
      })
    );

    return {
      session: {
        id: session.id,
        expiresAt: session.expiresAt
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        status: user.status
      }
    };
  });

  app.post("/login/mfa", async (request, reply) => {
    const token = parseCookie(request.headers.cookie, MFA_CHALLENGE_COOKIE);
    const body = assertObjectBody(request.body);
    const code = requireString(body, "code");

    if (!token) {
      throw new HttpError(401, "MFA_REQUIRED", "MFA challenge tidak valid");
    }

    const challenge = await prisma.mfaChallenge.findFirst({
      where: {
        challengeTokenHash: hashToken(token),
        status: MfaChallengeStatus.PENDING
      },
      select: {
        id: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            mfaTotpCredential: {
              select: {
                secretEncrypted: true,
                enabledAt: true
              }
            }
          }
        }
      }
    });

    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      challenge.user.status !== UserStatus.ACTIVE ||
      !challenge.user.mfaTotpCredential?.enabledAt
    ) {
      if (challenge?.expiresAt && challenge.expiresAt <= new Date()) {
        await prisma.mfaChallenge.update({
          where: {
            id: challenge.id
          },
          data: {
            status: MfaChallengeStatus.EXPIRED
          }
        });
      }

      throw new HttpError(401, "MFA_REQUIRED", "MFA challenge tidak valid");
    }

    const secret = decryptSecret(challenge.user.mfaTotpCredential.secretEncrypted);
    const isValid = verifyTotpCode(secret, code);

    if (!isValid) {
      await writeAudit(
        request,
        "mfa_failed",
        AuditResult.FAILED,
        { reason: "invalid_totp" },
        challenge.user.id
      );
      throw new HttpError(401, "INVALID_MFA_CODE", "Kode MFA tidak valid");
    }

    const usedChallenge = await prisma.mfaChallenge.updateMany({
      where: {
        id: challenge.id,
        status: MfaChallengeStatus.PENDING
      },
      data: {
        status: MfaChallengeStatus.USED,
        usedAt: new Date()
      }
    });

    if (usedChallenge.count !== 1) {
      throw new HttpError(401, "MFA_REQUIRED", "MFA challenge tidak valid");
    }

    const { token: sessionToken, session } = await createCentralSession(
      request,
      challenge.user
    );

    await writeAudit(
      request,
      "mfa_success",
      AuditResult.SUCCESS,
      { challengeId: challenge.id },
      challenge.user.id
    );

    reply.headers({
      "set-cookie": [
        serializeSessionCookie(sessionToken, {
          maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
          secure: isSecureCookieEnabled()
        }),
        clearMfaChallengeCookie(isSecureCookieEnabled())
      ]
    });

    return {
      session: {
        id: session.id,
        expiresAt: session.expiresAt
      },
      user: {
        id: challenge.user.id,
        name: challenge.user.name,
        email: challenge.user.email,
        status: challenge.user.status
      }
    };
  });

  app.get("/mfa/enroll", async (request, reply) => {
    const session = await requireCentralSession(request);
    const existingCredential = await prisma.mfaTotpCredential.findUnique({
      where: {
        userId: session.userId
      },
      select: {
        secretEncrypted: true,
        enabledAt: true
      }
    });

    reply.type("text/html; charset=utf-8");

    if (existingCredential?.enabledAt) {
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MFA Enrollment</title></head><body><main><h1>MFA sudah aktif</h1></main></body></html>`;
    }

    const secret = generateTotpSecret();
    const secretEncrypted = encryptSecret(secret);
    const credential = await prisma.mfaTotpCredential.upsert({
      where: {
        userId: session.userId
      },
      update: {
        secretEncrypted,
        enabledAt: null
      },
      create: {
        userId: session.userId,
        secretEncrypted
      },
      select: {
        secretEncrypted: true
      }
    });
    const plainSecret = decryptSecret(credential.secretEncrypted);
    const otpauthUri = createTotpUri({
      issuer: MFA_ISSUER,
      accountName: session.user.email,
      secret: plainSecret
    });

    return mfaEnrollmentHtml(plainSecret, otpauthUri);
  });

  app.post("/mfa/enroll", async (request) => {
    const session = await requireCentralSession(request);
    const body = assertObjectBody(request.body);
    const code = requireString(body, "code");
    const credential = await prisma.mfaTotpCredential.findUnique({
      where: {
        userId: session.userId
      },
      select: {
        id: true,
        secretEncrypted: true,
        enabledAt: true
      }
    });

    if (!credential) {
      throw new HttpError(400, "MFA_NOT_STARTED", "Enrollment MFA belum dimulai");
    }

    if (credential.enabledAt) {
      return {
        status: "ok",
        alreadyEnabled: true
      };
    }

    const secret = decryptSecret(credential.secretEncrypted);

    if (!verifyTotpCode(secret, code)) {
      await writeAudit(
        request,
        "mfa_failed",
        AuditResult.FAILED,
        { reason: "enrollment_invalid_totp" },
        session.userId
      );
      throw new HttpError(401, "INVALID_MFA_CODE", "Kode MFA tidak valid");
    }

    await prisma.mfaTotpCredential.update({
      where: {
        id: credential.id
      },
      data: {
        enabledAt: new Date()
      }
    });

    await writeAudit(
      request,
      "mfa_enrolled",
      AuditResult.SUCCESS,
      { method: "totp" },
      session.userId
    );

    return {
      status: "ok",
      method: "totp"
    };
  });

  app.get("/session", async (request) => {
    const session = await requireCentralSession(request);

    return {
      session: {
        id: session.id,
        userId: session.userId
      },
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        status: session.user.status,
        groups: session.user.groups.map((entry) => entry.group)
      }
    };
  });

  app.get("/internal/sessions/:id", async (request) => {
    requireInternalToken(request);

    const { id } = request.params as { id?: string };
    const clientId =
      typeof request.headers["x-client-id"] === "string"
        ? request.headers["x-client-id"]
        : undefined;

    if (!id) {
      throw new HttpError(400, "INVALID_BODY", "id wajib diisi");
    }

    const session = await prisma.ssoSession.findUnique({
      where: {
        id
      },
      select: {
        id: true,
        userId: true,
        status: true,
        revokeReason: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            status: true
          }
        }
      }
    });

    const active =
      Boolean(session) &&
      session?.status === SessionStatus.ACTIVE &&
      session.revokedAt === null &&
      session.expiresAt > new Date() &&
      session.user.status === UserStatus.ACTIVE;
    const accessPolicyTargetsCurrentApplication =
      !active &&
      session?.revokeReason === "access_policy_changed" &&
      clientId
        ? Boolean(
            await prisma.event.findFirst({
              where: {
                centralSessionId: id,
                eventType: "AccessPolicyChanged",
                application: {
                  clientId
                }
              },
              select: {
                id: true
              }
            })
          )
        : false;

    return {
      active,
      accessPolicyTargetsCurrentApplication,
      session: session
        ? {
            id: session.id,
            userId: session.userId,
            status: session.status,
            revokeReason: session.revokeReason
          }
        : null
    };
  });

  app.post("/logout-sso", async (request, reply) => {
    const session = await requireCentralSession(request);

    await prisma.$transaction(async (tx) => {
      await tx.ssoSession.update({
        where: {
          id: session.id
        },
        data: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: "sso_logout"
        }
      });

      await tx.accessToken.updateMany({
        where: {
          ssoSessionId: session.id,
          status: TokenStatus.ACTIVE
        },
        data: {
          status: TokenStatus.REVOKED,
          revokedAt: new Date()
        }
      });

      await createRevocationEvent(tx, {
        eventType: "SessionRevoked",
        userId: session.userId,
        centralSessionId: session.id,
        payload: {
          reason: "sso_logout",
          userId: session.userId,
          centralSessionId: session.id
        },
        targetApplicationIds: await getActiveApplicationIds(tx)
      });

      await tx.auditLog.create({
        data: {
          eventType: "LogoutSso",
          userId: session.userId,
          sessionId: session.id,
          result: AuditResult.SUCCESS,
          metadata: {
            reason: "sso_logout"
          },
          ipAddress: request.ip
        }
      });
    });

    reply.header("set-cookie", clearSessionCookie(isSecureCookieEnabled()));

    return {
      status: "ok"
    };
  });
}

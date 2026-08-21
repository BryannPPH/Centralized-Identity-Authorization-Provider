import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import {
  Prisma,
  PrismaClient,
  SessionStatus
} from "../../generated/prisma/client.js";
import { checkDatabase, registerHealthRoutes } from "../../shared/health.js";
import { createCodeChallenge } from "../../shared/pkce.js";

const LOCAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const OAUTH_STATE_MAX_AGE_SECONDS = 5 * 60;

type AppConfig = {
  applicationId: string;
  displayName: string;
  port: number;
  host: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  authProviderPublicUrl: string;
  authProviderInternalUrl: string;
  databaseUrl: string;
  internalLogoutToken: string;
};

type Profile = {
  id: string;
  name: string;
  email: string;
  groups: Array<{
    id: string;
    name: string;
  }>;
  centralSessionId: string;
  application: {
    clientId: string;
  };
};

type LocalSession = {
  id: string;
  applicationId: string;
  externalUserId: string;
  centralSessionId: string;
  status: SessionStatus;
  createdAt: Date;
  expiresAt: Date;
  profile: {
    name: string;
    email: string;
    groups: Prisma.JsonValue | null;
  } | null;
};

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getRelyingAppConfig(defaults: {
  applicationId: string;
  displayName: string;
  port: number;
}): AppConfig {
  return {
    applicationId: process.env.APPLICATION_ID ?? defaults.applicationId,
    displayName: process.env.APP_DISPLAY_NAME ?? defaults.displayName,
    port: Number(process.env.PORT ?? defaults.port),
    host: process.env.HOST ?? "0.0.0.0",
    clientId: requireEnv("CLIENT_ID"),
    clientSecret: requireEnv("CLIENT_SECRET"),
    baseUrl: requireEnv("APP_BASE_URL"),
    authProviderPublicUrl: requireEnv("AUTH_PROVIDER_PUBLIC_URL"),
    authProviderInternalUrl:
      process.env.AUTH_PROVIDER_INTERNAL_URL ?? requireEnv("AUTH_PROVIDER_PUBLIC_URL"),
    databaseUrl: requireEnv("DATABASE_URL"),
    internalLogoutToken: requireEnv("INTERNAL_LOGOUT_TOKEN")
  };
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl
  });

  return new PrismaClient({
    adapter
  });
}

function cookieName(config: AppConfig, suffix: string): string {
  return `${config.clientId.replaceAll("-", "_")}_${suffix}`;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
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

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  httpOnly = true
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (httpOnly) {
    parts.push("HttpOnly");
  }

  if (process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearCookie(name: string): string {
  return serializeCookie(name, "", 0);
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function localSessionExpiresAt(): Date {
  return new Date(Date.now() + LOCAL_SESSION_MAX_AGE_SECONDS * 1000);
}

function callbackUrl(config: AppConfig): string {
  return `${config.baseUrl}/callback`;
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
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
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      header {
        border-bottom: 1px solid var(--line);
        background: var(--panel);
      }

      .wrap {
        width: min(980px, calc(100% - 32px));
        margin: 0 auto;
      }

      header .wrap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 64px;
        gap: 16px;
      }

      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      main.wrap {
        padding: 24px 0 40px;
      }

      h1 {
        margin: 0;
        font-size: 24px;
      }

      h2 {
        margin: 0 0 12px;
        font-size: 16px;
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        padding: 16px;
        margin-bottom: 16px;
      }

      dl {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 8px 12px;
        margin: 0;
      }

      dt {
        color: var(--muted);
        font-weight: 700;
      }

      dd {
        margin: 0;
      }

      table {
        width: 100%;
        min-width: 640px;
        border-collapse: collapse;
        table-layout: fixed;
      }

      th,
      td {
        border-top: 1px solid var(--line);
        padding: 9px 8px;
        text-align: center;
        vertical-align: middle;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
      }

      button,
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        border: 1px solid var(--accent);
        border-radius: 6px;
        background: var(--accent);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 8px 12px;
        text-decoration: none;
      }

      button.secondary,
      a.button.secondary {
        border-color: var(--line);
        background: #ffffff;
        color: var(--text);
      }

      .muted {
        color: var(--muted);
      }

      .error {
        color: var(--danger);
      }

      .table-wrap {
        overflow-x: auto;
      }

      @media (max-width: 640px) {
        .wrap {
          width: min(100% - 20px, 980px);
        }

        dl {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function groupsToText(groups: Prisma.JsonValue | null): string {
  if (!Array.isArray(groups)) {
    return "-";
  }

  const names = groups
    .map((group) => {
      if (group && typeof group === "object" && "name" in group) {
        const name = (group as { name?: unknown }).name;
        return typeof name === "string" ? name : undefined;
      }
      return undefined;
    })
    .filter((name): name is string => Boolean(name));

  return names.length > 0 ? names.join(", ") : "-";
}

function errorBody(code: string, message: string, requestId: string): object {
  return {
    error: {
      code,
      message,
      requestId
    }
  };
}

function getQueryString(request: FastifyRequest, key: string): string | undefined {
  const value = (request.query as Record<string, unknown>)[key];

  return typeof value === "string" ? value : undefined;
}

function assertObjectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY", "Request body harus berupa object JSON");
  }

  return body as Record<string, unknown>;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];

  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

async function writeActivity(
  prisma: PrismaClient,
  config: AppConfig,
  eventType: string,
  message: string,
  request: FastifyRequest,
  metadata?: Prisma.InputJsonValue
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      applicationId: config.applicationId,
      eventType,
      message,
      requestId: request.id,
      metadata
    }
  });
}

async function getCurrentSession(
  prisma: PrismaClient,
  config: AppConfig,
  request: FastifyRequest
): Promise<LocalSession | null> {
  const token = parseCookie(request.headers.cookie, cookieName(config, "session"));

  if (!token) {
    return null;
  }

  const session = await prisma.localSession.findFirst({
    where: {
      applicationId: config.applicationId,
      sessionTokenHash: hashToken(token),
      status: SessionStatus.ACTIVE,
      revokedAt: null,
      expiresAt: {
        gt: new Date()
      }
    },
    select: {
      id: true,
      applicationId: true,
      externalUserId: true,
      centralSessionId: true,
      status: true,
      createdAt: true,
      expiresAt: true
    }
  });

  if (!session) {
    return null;
  }

  const canKeepLocalSession = await canKeepLocalSessionFromCentralSession(
    config,
    session.centralSessionId
  );

  if (!canKeepLocalSession) {
    await prisma.$transaction(async (tx) => {
      await tx.localSession.update({
        where: {
          id: session.id
        },
        data: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: "central_session_inactive"
        }
      });

      await tx.activityLog.create({
        data: {
          applicationId: config.applicationId,
          eventType: "CentralSessionInactive",
          message: "Local session revoked after central session validation failed",
          requestId: request.id,
          metadata: {
            centralSessionId: session.centralSessionId
          }
        }
      });
    });

    return null;
  }

  await prisma.localSession.update({
    where: {
      id: session.id
    },
    data: {
      lastActivityAt: new Date()
    }
  });

  const profile = await prisma.profileCache.findUnique({
    where: {
      applicationId_externalUserId: {
        applicationId: config.applicationId,
        externalUserId: session.externalUserId
      }
    },
    select: {
      name: true,
      email: true,
      groups: true
    }
  });

  return {
    ...session,
    profile
  };
}

async function canKeepLocalSessionFromCentralSession(
  config: AppConfig,
  centralSessionId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${config.authProviderInternalUrl}/internal/sessions/${centralSessionId}`,
      {
        headers: {
          "x-internal-token": config.internalLogoutToken,
          "x-client-id": config.clientId
        }
      }
    );

    if (!response.ok) {
      return false;
    }

    const body = (await response.json()) as {
      active?: unknown;
      accessPolicyTargetsCurrentApplication?: unknown;
      session?: {
        revokeReason?: unknown;
      } | null;
    };

    if (body.active === true) {
      return true;
    }

    return (
      body.session?.revokeReason === "access_policy_changed" &&
      body.accessPolicyTargetsCurrentApplication !== true
    );
  } catch {
    return false;
  }
}

async function exchangeCode(
  config: AppConfig,
  code: string,
  codeVerifier: string
): Promise<{ access_token: string }> {
  const response = await fetch(`${config.authProviderInternalUrl}/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: callbackUrl(config),
      code_verifier: codeVerifier
    })
  });
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    throw new HttpError(400, "INVALID_GRANT", JSON.stringify(body));
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new HttpError(400, "INVALID_GRANT", "Token response tidak valid");
  }

  return body as { access_token: string };
}

async function getUserinfo(config: AppConfig, accessToken: string): Promise<Profile> {
  const response = await fetch(
    `${config.authProviderInternalUrl}/userinfo?client_id=${encodeURIComponent(config.clientId)}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    }
  );
  const body = (await response.json()) as unknown;

  if (!response.ok) {
    throw new HttpError(400, "INVALID_GRANT", JSON.stringify(body));
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { id?: unknown }).id !== "string" ||
    typeof (body as { name?: unknown }).name !== "string" ||
    typeof (body as { email?: unknown }).email !== "string" ||
    typeof (body as { centralSessionId?: unknown }).centralSessionId !== "string"
  ) {
    throw new HttpError(400, "INVALID_GRANT", "Userinfo response tidak valid");
  }

  return body as Profile;
}

function loginPage(config: AppConfig): string {
  return htmlPage(
    config.displayName,
    `<header><div class="wrap"><h1>${escapeHtml(config.displayName)}</h1></div></header>
    <main class="wrap">
      <section class="panel">
        <h2>Login</h2>
        <p class="muted">You are not signed in</p>
        <a class="button" href="/login">Login with Auth Provider</a>
      </section>
    </main>`
  );
}

function homePage(config: AppConfig, session: LocalSession, activityRows: string, eventRows: string): string {
  const profile = session.profile;
  const passwordUrl = `${config.authProviderPublicUrl}/password`;

  return htmlPage(
    config.displayName,
    `<header>
      <div class="wrap">
        <h1>${escapeHtml(config.displayName)}</h1>
        <div class="header-actions">
          <a class="button secondary" href="${escapeHtml(passwordUrl)}">Change Password</a>
          <form method="post" action="/logout"><button class="secondary" type="submit">Local Logout</button></form>
        </div>
      </div>
    </header>
    <main class="wrap">
      <section class="panel">
        <h2>Hello, ${escapeHtml(profile?.name ?? "User")}</h2>
        <dl>
          <dt>Email</dt><dd>${escapeHtml(profile?.email ?? "-")}</dd>
          <dt>Groups</dt><dd>${escapeHtml(groupsToText(profile?.groups ?? null))}</dd>
          <dt>Local session</dt><dd>${escapeHtml(session.status)}</dd>
          <dt>Created</dt><dd>${escapeHtml(session.createdAt.toISOString())}</dd>
          <dt>Expires</dt><dd>${escapeHtml(session.expiresAt.toISOString())}</dd>
          <dt>Central session</dt><dd>${escapeHtml(session.centralSessionId)}</dd>
        </dl>
      </section>
      <section class="panel">
        <h2>Activity Log</h2>
        <div class="table-wrap"><table><thead><tr><th>Event</th><th>Message</th><th>Time</th></tr></thead><tbody>${activityRows}</tbody></table></div>
      </section>
      <section class="panel">
        <h2>Processed Events</h2>
        <div class="table-wrap"><table><thead><tr><th>Event</th><th>Type</th><th>Result</th><th>Time</th></tr></thead><tbody>${eventRows}</tbody></table></div>
      </section>
    </main>`
  );
}

function tableEmpty(colspan: number): string {
  return `<tr><td colspan="${colspan}" class="muted">No data</td></tr>`;
}

export async function registerRelyingApp(app: FastifyInstance, config: AppConfig): Promise<void> {
  const prisma = createPrismaClient(config.databaseUrl);

  app.decorate("prisma", prisma);
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_, body, done) => {
      const parsedBody: Record<string, string> = {};

      for (const [key, value] of new URLSearchParams(body.toString())) {
        parsedBody[key] = value;
      }

      done(null, parsedBody);
    }
  );

  registerHealthRoutes(app, {
    service: config.applicationId,
    readinessChecks: [
      {
        name: "database",
        check: () => checkDatabase(prisma)
      }
    ]
  });

  app.get("/", async (request, reply) => {
    const session = await getCurrentSession(prisma, config, request);

    reply.type("text/html; charset=utf-8");

    if (!session) {
      return loginPage(config);
    }

    const [activityLogs, processedEvents] = await Promise.all([
      prisma.activityLog.findMany({
        where: {
          applicationId: config.applicationId
        },
        take: 10,
        orderBy: {
          createdAt: "desc"
        },
        select: {
          eventType: true,
          message: true,
          createdAt: true
        }
      }),
      prisma.processedEvent.findMany({
        where: {
          applicationId: config.applicationId
        },
        take: 10,
        orderBy: {
          processedAt: "desc"
        },
        select: {
          eventId: true,
          eventType: true,
          result: true,
          processedAt: true
        }
      })
    ]);
    const activityRows =
      activityLogs.length > 0
        ? activityLogs
            .map(
              (log) =>
                `<tr><td>${escapeHtml(log.eventType)}</td><td>${escapeHtml(log.message)}</td><td>${escapeHtml(log.createdAt.toISOString())}</td></tr>`
            )
            .join("")
        : tableEmpty(3);
    const eventRows =
      processedEvents.length > 0
        ? processedEvents
            .map(
              (event) =>
                `<tr><td>${escapeHtml(event.eventId)}</td><td>${escapeHtml(event.eventType)}</td><td>${escapeHtml(event.result)}</td><td>${escapeHtml(event.processedAt.toISOString())}</td></tr>`
            )
            .join("")
        : tableEmpty(4);

    return homePage(config, session, activityRows, eventRows);
  });

  app.get("/login", async (request, reply) => {
    const state = generateToken();
    const codeVerifier = generateToken();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const authorizeUrl = new URL(`${config.authProviderPublicUrl}/authorize`);

    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl(config));
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    await writeActivity(prisma, config, "LoginStarted", "Redirected to Auth Provider", request, {
      state
    });

    reply.headers({
      "set-cookie": [
        serializeCookie(cookieName(config, "oauth_state"), state, OAUTH_STATE_MAX_AGE_SECONDS),
        serializeCookie(
          cookieName(config, "pkce_verifier"),
          codeVerifier,
          OAUTH_STATE_MAX_AGE_SECONDS
        )
      ]
    });
    reply.redirect(authorizeUrl.toString());
  });

  app.get("/callback", async (request, reply) => {
    const error = getQueryString(request, "error");

    if (error) {
      await writeActivity(prisma, config, "LoginFailed", "Authorization request denied", request, {
        error
      });
      throw new HttpError(400, "ACCESS_DENIED", "Authorization request ditolak");
    }

    const code = getQueryString(request, "code");
    const state = getQueryString(request, "state");
    const expectedState = parseCookie(request.headers.cookie, cookieName(config, "oauth_state"));
    const codeVerifier = parseCookie(request.headers.cookie, cookieName(config, "pkce_verifier"));

    if (!code || !state || !expectedState || !codeVerifier || state !== expectedState) {
      await writeActivity(prisma, config, "LoginFailed", "Callback state validation failed", request);
      throw new HttpError(400, "INVALID_STATE", "State OAuth tidak valid");
    }

    await writeActivity(
      prisma,
      config,
      "AuthorizationCodeReceived",
      "Authorization code received in callback",
      request,
      {
        state
      }
    );
    const token = await exchangeCode(config, code, codeVerifier);
    await writeActivity(
      prisma,
      config,
      "TokenExchanged",
      "Authorization code exchanged through back channel",
      request
    );
    const profile = await getUserinfo(config, token.access_token);
    await writeActivity(prisma, config, "UserinfoFetched", "User profile fetched", request, {
      externalUserId: profile.id,
      clientId: profile.application.clientId
    });
    const localSessionToken = generateToken();
    const expiresAt = localSessionExpiresAt();

    await prisma.$transaction(async (tx) => {
      await tx.profileCache.upsert({
        where: {
          applicationId_externalUserId: {
            applicationId: config.applicationId,
            externalUserId: profile.id
          }
        },
        update: {
          name: profile.name,
          email: profile.email,
          groups: profile.groups,
          syncedAt: new Date()
        },
        create: {
          applicationId: config.applicationId,
          externalUserId: profile.id,
          name: profile.name,
          email: profile.email,
          groups: profile.groups,
          syncedAt: new Date()
        }
      });

      await tx.localSession.create({
        data: {
          applicationId: config.applicationId,
          sessionTokenHash: hashToken(localSessionToken),
          externalUserId: profile.id,
          centralSessionId: profile.centralSessionId,
          status: SessionStatus.ACTIVE,
          expiresAt,
          lastActivityAt: new Date()
        }
      });

      await tx.activityLog.create({
        data: {
          applicationId: config.applicationId,
          eventType: "LoginCompleted",
          message: "Local session created from Auth Provider profile",
          requestId: request.id,
          metadata: {
            externalUserId: profile.id,
            centralSessionId: profile.centralSessionId,
            clientId: profile.application.clientId
          }
        }
      });
    });

    reply.headers({
      "set-cookie": [
        serializeCookie(
          cookieName(config, "session"),
          localSessionToken,
          LOCAL_SESSION_MAX_AGE_SECONDS
        ),
        clearCookie(cookieName(config, "oauth_state")),
        clearCookie(cookieName(config, "pkce_verifier"))
      ]
    });
    reply.redirect("/");
  });

  app.post("/logout", async (request, reply) => {
    const token = parseCookie(request.headers.cookie, cookieName(config, "session"));

    if (token) {
      const session = await prisma.localSession.findFirst({
        where: {
          applicationId: config.applicationId,
          sessionTokenHash: hashToken(token),
          status: SessionStatus.ACTIVE
        },
        select: {
          id: true
        }
      });

      if (session) {
        await prisma.$transaction(async (tx) => {
          await tx.localSession.update({
            where: {
              id: session.id
            },
            data: {
              status: SessionStatus.REVOKED,
              revokedAt: new Date(),
              revokeReason: "local_logout"
            }
          });

          await tx.activityLog.create({
            data: {
              applicationId: config.applicationId,
              eventType: "LocalLogout",
              message: "Local session revoked",
              requestId: request.id
            }
          });
        });
      }
    }

    reply.header("set-cookie", clearCookie(cookieName(config, "session")));
    reply.redirect("/");
  });

  app.post("/internal/logout", async (request) => {
    const token = request.headers["x-internal-token"];

    if (token !== config.internalLogoutToken) {
      throw new HttpError(401, "UNAUTHORIZED", "Internal token tidak valid");
    }

    const body = assertObjectBody(request.body);
    const eventId = optionalString(body, "eventId");
    const eventType = optionalString(body, "eventType") ?? "SessionRevoked";
    const userId = optionalString(body, "userId");
    const centralSessionId = optionalString(body, "centralSessionId");

    if (!eventId) {
      throw new HttpError(400, "INVALID_BODY", "eventId wajib diisi");
    }

    if (!userId && !centralSessionId) {
      throw new HttpError(
        400,
        "INVALID_BODY",
        "userId atau centralSessionId wajib diisi"
      );
    }

    const existing = await prisma.processedEvent.findUnique({
      where: {
        applicationId_eventId: {
          applicationId: config.applicationId,
          eventId
        }
      }
    });

    if (existing) {
      return {
        status: "ok",
        duplicate: true
      };
    }

    const where: Prisma.LocalSessionWhereInput = {
      applicationId: config.applicationId,
      status: SessionStatus.ACTIVE
    };

    if (userId) {
      where.externalUserId = userId;
    }

    if (centralSessionId) {
      where.centralSessionId = centralSessionId;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.processedEvent.create({
        data: {
          applicationId: config.applicationId,
          eventId,
          eventType,
          result: "processing",
          action: "started"
        }
      });

      const updateResult = await tx.localSession.updateMany({
        where,
        data: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: eventType
        }
      });

      await tx.processedEvent.update({
        where: {
          applicationId_eventId: {
            applicationId: config.applicationId,
            eventId
          }
        },
        data: {
          result: "succeeded",
          action: `revoked_${updateResult.count}_sessions`
        }
      });

      await tx.activityLog.create({
        data: {
          applicationId: config.applicationId,
          eventType: "InternalLogout",
          message: `Processed ${eventType}`,
          requestId: request.id,
          metadata: {
            eventId,
            userId,
            centralSessionId,
            revokedSessions: updateResult.count
          }
        }
      });

      return updateResult;
    }).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        return {
          count: 0,
          duplicate: true
        };
      }

      throw error;
    });

    if ("duplicate" in result) {
      return {
        status: "ok",
        duplicate: true
      };
    }

    return {
      status: "ok",
      revokedSessions: result.count
    };
  });

  app.get("/activity-logs", async () => {
    return prisma.activityLog.findMany({
      where: {
        applicationId: config.applicationId
      },
      take: 50,
      orderBy: {
        createdAt: "desc"
      }
    });
  });

  app.get("/processed-events", async () => {
    return prisma.processedEvent.findMany({
      where: {
        applicationId: config.applicationId
      },
      take: 50,
      orderBy: {
        processedAt: "desc"
      }
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send(errorBody(error.code, error.message, request.id));
      return;
    }

    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      reply
        .status(error.statusCode)
        .send(errorBody(error.code ?? "BAD_REQUEST", error.message, request.id));
      return;
    }

    request.log.error(error);
    reply
      .status(500)
      .send(errorBody("INTERNAL_ERROR", "Terjadi kesalahan server", request.id));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(errorBody("NOT_FOUND", "Endpoint tidak ditemukan", request.id));
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

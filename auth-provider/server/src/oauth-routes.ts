import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApplicationStatus,
  AuditResult,
  Prisma,
  SessionStatus,
  TokenStatus,
  UserStatus
} from "../../../generated/prisma/client.js";
import { createCodeChallenge, validatePkce } from "../../../shared/pkce.js";
import { hasAllowedGroup } from "../../shared/policy.js";
import { generateToken, hashToken, verifySecret } from "./crypto.js";
import { prisma } from "./db.js";
import { HttpError, assertObjectBody, requireString } from "./http.js";
import { getCentralSession } from "./auth-routes.js";

const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

function getQueryString(request: FastifyRequest, key: string): string {
  const value = (request.query as Record<string, unknown>)[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "INVALID_AUTHORIZATION_REQUEST", `${key} wajib diisi`);
  }

  return value.trim();
}

function getOptionalQueryString(request: FastifyRequest, key: string): string | undefined {
  const value = (request.query as Record<string, unknown>)[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_AUTHORIZATION_REQUEST", `${key} tidak valid`);
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function getBodyString(body: Record<string, unknown>, key: string): string {
  return requireString(body, key);
}

function getBearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;

  if (!authorization) {
    throw new HttpError(401, "INVALID_TOKEN", "Bearer token wajib diisi");
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "INVALID_TOKEN", "Bearer token tidak valid");
  }

  return token;
}

function getOptionalBodyString(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = body[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_TOKEN_REQUEST", `${key} harus berupa string`);
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function appendRedirectParams(
  redirectUri: string,
  params: Record<string, string | undefined>
): string {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function getAuthorizationCodeExpiresAt(): Date {
  return new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000);
}

function getAccessTokenExpiresAt(): Date {
  return new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
}

async function writeAudit(
  request: FastifyRequest,
  eventType: string,
  result: AuditResult,
  metadata: Prisma.InputJsonValue,
  target: { userId?: string; applicationId?: string; sessionId?: string } = {}
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      eventType,
      userId: target.userId,
      applicationId: target.applicationId,
      sessionId: target.sessionId,
      result,
      metadata,
      ipAddress: request.ip
    }
  });
}

function redirectToLogin(request: FastifyRequest): string {
  return `/login?returnTo=${encodeURIComponent(request.url)}`;
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/authorize", async (request, reply) => {
    const clientId = getQueryString(request, "client_id");
    const redirectUri = getQueryString(request, "redirect_uri");
    const state = getOptionalQueryString(request, "state");
    const codeChallenge = getQueryString(request, "code_challenge");
    const codeChallengeMethod = getOptionalQueryString(request, "code_challenge_method") ?? "S256";

    if (codeChallengeMethod !== "S256") {
      throw new HttpError(
        400,
        "INVALID_AUTHORIZATION_REQUEST",
        "code_challenge_method harus S256"
      );
    }

    const application = await prisma.application.findUnique({
      where: {
        clientId
      },
      select: {
        id: true,
        clientId: true,
        status: true,
        redirectUris: {
          where: {
            redirectUri
          },
          select: {
            id: true
          }
        },
        policies: {
          select: {
            groupId: true
          }
        }
      }
    });

    if (!application || application.status !== ApplicationStatus.ACTIVE) {
      throw new HttpError(400, "INVALID_CLIENT", "Aplikasi tidak valid");
    }

    if (application.redirectUris.length !== 1) {
      throw new HttpError(400, "INVALID_REDIRECT_URI", "redirect_uri tidak terdaftar");
    }

    const session = await getCentralSession(request);

    if (!session) {
      reply.redirect(redirectToLogin(request));
      return;
    }

    const allowedGroupIds = application.policies.map((policy) => policy.groupId);
    const userGroupIds = session.user.groups.map((entry) => entry.group.id);
    const isAllowed = hasAllowedGroup(allowedGroupIds, userGroupIds);

    if (!isAllowed) {
      await writeAudit(
        request,
        "PolicyDenied",
        AuditResult.FAILED,
        {
          clientId,
          redirectUri,
          userGroups: userGroupIds
        },
        {
          userId: session.userId,
          applicationId: application.id,
          sessionId: session.id
        }
      );
      reply.redirect(
        appendRedirectParams(redirectUri, {
          error: "access_denied",
          state
        })
      );
      return;
    }

    const code = generateToken();

    const authorizationCode = await prisma.authorizationCode.create({
      data: {
        codeHash: hashToken(code),
        userId: session.userId,
        applicationId: application.id,
        ssoSessionId: session.id,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        expiresAt: getAuthorizationCodeExpiresAt()
      },
      select: {
        id: true,
        expiresAt: true
      }
    });

    await writeAudit(
      request,
      "AuthorizationCodeIssued",
      AuditResult.SUCCESS,
      {
        clientId,
        redirectUri,
        authorizationCodeId: authorizationCode.id,
        expiresAt: authorizationCode.expiresAt.toISOString()
      },
      {
        userId: session.userId,
        applicationId: application.id,
        sessionId: session.id
      }
    );

    reply.redirect(
      appendRedirectParams(redirectUri, {
        code,
        state
      })
    );
  });

  app.post("/token", async (request, reply) => {
    const body = assertObjectBody(request.body);
    const clientId = getBodyString(body, "client_id");
    const clientSecret = getOptionalBodyString(body, "client_secret");
    const code = getBodyString(body, "code");
    const redirectUri = getBodyString(body, "redirect_uri");
    const codeVerifier = getBodyString(body, "code_verifier");
    const codeHash = hashToken(code);

    const authorizationCode = await prisma.authorizationCode.findUnique({
      where: {
        codeHash
      },
      select: {
        id: true,
        userId: true,
        applicationId: true,
        ssoSessionId: true,
        redirectUri: true,
        codeChallenge: true,
        codeChallengeMethod: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            status: true
          }
        },
        ssoSession: {
          select: {
            status: true,
            revokedAt: true,
            expiresAt: true
          }
        },
        application: {
          select: {
            clientId: true,
            clientSecretHash: true,
            status: true
          }
        }
      }
    });

    if (!authorizationCode) {
      throw new HttpError(400, "INVALID_GRANT", "Authorization code tidak valid");
    }

    if (
      authorizationCode.application.clientId !== clientId ||
      authorizationCode.application.status !== ApplicationStatus.ACTIVE
    ) {
      throw new HttpError(400, "INVALID_CLIENT", "Client tidak valid");
    }

    if (authorizationCode.application.clientSecretHash) {
      if (
        !clientSecret ||
        !(await verifySecret(clientSecret, authorizationCode.application.clientSecretHash))
      ) {
        throw new HttpError(401, "INVALID_CLIENT", "Client tidak valid");
      }
    }

    if (
      authorizationCode.usedAt ||
      authorizationCode.expiresAt <= new Date() ||
      authorizationCode.redirectUri !== redirectUri ||
      authorizationCode.user.status !== UserStatus.ACTIVE ||
      authorizationCode.ssoSession.status !== SessionStatus.ACTIVE ||
      authorizationCode.ssoSession.revokedAt !== null ||
      authorizationCode.ssoSession.expiresAt <= new Date()
    ) {
      throw new HttpError(400, "INVALID_GRANT", "Authorization code tidak valid");
    }

    if (
      !validatePkce(
        codeVerifier,
        authorizationCode.codeChallenge,
        authorizationCode.codeChallengeMethod
      )
    ) {
      throw new HttpError(400, "INVALID_GRANT", "PKCE verifier tidak valid");
    }

    const accessToken = generateToken();
    const tokenRecord = await prisma.$transaction(async (tx) => {
      const updated = await tx.authorizationCode.updateMany({
        where: {
          id: authorizationCode.id,
          usedAt: null
        },
        data: {
          usedAt: new Date()
        }
      });

      if (updated.count !== 1) {
        throw new HttpError(400, "INVALID_GRANT", "Authorization code sudah digunakan");
      }

      return tx.accessToken.create({
        data: {
          tokenHash: hashToken(accessToken),
          userId: authorizationCode.userId,
          applicationId: authorizationCode.applicationId,
          ssoSessionId: authorizationCode.ssoSessionId,
          scopes: {
            clientId
          },
          status: TokenStatus.ACTIVE,
          expiresAt: getAccessTokenExpiresAt()
        },
        select: {
          id: true,
          expiresAt: true
        }
      });
    });

    await writeAudit(
      request,
      "TokenIssued",
      AuditResult.SUCCESS,
      {
        clientId,
        tokenId: tokenRecord.id,
        expiresAt: tokenRecord.expiresAt.toISOString()
      },
      {
        userId: authorizationCode.userId,
        applicationId: authorizationCode.applicationId,
        sessionId: authorizationCode.ssoSessionId
      }
    );

    reply.status(200);
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      expires_at: tokenRecord.expiresAt
    };
  });

  app.get("/userinfo", async (request) => {
    const accessToken = getBearerToken(request);
    const expectedClientId = getOptionalQueryString(request, "client_id");
    const token = await prisma.accessToken.findFirst({
      where: {
        tokenHash: hashToken(accessToken),
        status: TokenStatus.ACTIVE,
        revokedAt: null,
        expiresAt: {
          gt: new Date()
        },
        user: {
          status: UserStatus.ACTIVE
        },
        application: {
          status: ApplicationStatus.ACTIVE
        },
        ssoSession: {
          status: SessionStatus.ACTIVE,
          revokedAt: null,
          expiresAt: {
            gt: new Date()
          }
        }
      },
      select: {
        id: true,
        application: {
          select: {
            id: true,
            clientId: true
          }
        },
        ssoSessionId: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
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

    if (!token || (expectedClientId && token.application.clientId !== expectedClientId)) {
      throw new HttpError(401, "INVALID_TOKEN", "Bearer token tidak valid");
    }

    return {
      id: token.user.id,
      name: token.user.name,
      email: token.user.email,
      groups: token.user.groups.map((entry) => entry.group),
      centralSessionId: token.ssoSessionId,
      application: {
        id: token.application.id,
        clientId: token.application.clientId
      }
    };
  });
}

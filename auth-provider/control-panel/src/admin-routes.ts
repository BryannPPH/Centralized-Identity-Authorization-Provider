import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApplicationStatus,
  AuditResult,
  PolicyEffect,
  Prisma,
  UserStatus
} from "../../../generated/prisma/client.js";
import {
  createRevocationEvent,
  getActiveApplicationIds,
  revokeUserCentralSessions
} from "../../shared/events.js";
import { hasAllowedGroup } from "../../shared/policy.js";
import { hashSecret } from "./crypto.js";
import { prisma } from "./db.js";
import {
  HttpError,
  assertObjectBody,
  getParam,
  optionalString,
  requireString,
  requireUuid
} from "./http.js";

const GROUP_SELECT = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true
} as const;

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  groups: {
    select: {
      group: {
        select: GROUP_SELECT
      }
    },
    orderBy: {
      group: {
        name: "asc"
      }
    }
  }
} as const;

const APPLICATION_SELECT = {
  id: true,
  name: true,
  clientId: true,
  status: true,
  launchUrl: true,
  logoutNotificationUrl: true,
  createdAt: true,
  updatedAt: true,
  redirectUris: {
    select: {
      id: true,
      redirectUri: true,
      createdAt: true
    },
    orderBy: {
      redirectUri: "asc"
    }
  },
  policies: {
    select: {
      id: true,
      effect: true,
      createdAt: true,
      group: {
        select: GROUP_SELECT
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  }
} as const;

function parseUserStatus(body: Record<string, unknown>): UserStatus | undefined {
  const rawStatus = optionalString(body, "status");

  if (!rawStatus) {
    return undefined;
  }

  const status = rawStatus.toUpperCase();

  if (status === UserStatus.ACTIVE || status === UserStatus.INACTIVE) {
    return status;
  }

  throw new HttpError(400, "INVALID_BODY", "status user harus ACTIVE atau INACTIVE");
}

function parseApplicationStatus(
  body: Record<string, unknown>
): ApplicationStatus | undefined {
  const rawStatus = optionalString(body, "status");

  if (!rawStatus) {
    return undefined;
  }

  const status = rawStatus.toUpperCase();

  if (status === ApplicationStatus.ACTIVE || status === ApplicationStatus.INACTIVE) {
    return status;
  }

  throw new HttpError(400, "INVALID_BODY", "status application harus ACTIVE atau INACTIVE");
}

function parsePolicyEffect(body: Record<string, unknown>): PolicyEffect {
  const rawEffect = optionalString(body, "effect");

  if (!rawEffect) {
    return PolicyEffect.ALLOW;
  }

  const effect = rawEffect.toUpperCase();

  if (effect === PolicyEffect.ALLOW) {
    return effect;
  }

  throw new HttpError(400, "INVALID_BODY", "effect policy harus ALLOW");
}

function parseLimit(request: FastifyRequest, defaultLimit = 50): number {
  const query = request.query as Record<string, unknown>;
  const rawLimit = query.limit;

  if (rawLimit === undefined) {
    return defaultLimit;
  }

  if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
    throw new HttpError(400, "INVALID_QUERY", "limit harus berupa angka");
  }

  return Math.min(Math.max(Number(rawLimit), 1), 100);
}

const AUDIT_SECTION_EVENT_TYPES = {
  users: [
    "AdminUserCreated",
    "AdminUserUpdated",
    "AdminUserPasswordChanged",
    "LoginSuccess",
    "LoginFailed",
    "LogoutSso",
    "PasswordChanged",
    "PasswordChangeFailed",
    "SessionRevoked",
    "mfa_enrolled",
    "mfa_success",
    "mfa_failed"
  ],
  groups: [
    "AdminGroupCreated",
    "AdminGroupUpdated",
    "AdminGroupDeleted",
    "AdminGroupUserAdded",
    "AdminGroupUserRemoved"
  ],
  applications: [
    "AccessPolicyChanged",
    "AdminApplicationCreated",
    "AdminApplicationUpdated",
    "AdminApplicationDeleted",
    "AdminApplicationRedirectUriCreated",
    "AdminApplicationRedirectUriUpdated",
    "AdminApplicationRedirectUriDeleted",
    "AdminApplicationPolicyCreated",
    "AdminApplicationPolicyDeleted",
    "AuthorizationCodeIssued",
    "PolicyDenied",
    "TokenIssued"
  ]
} as const;

type AuditSection = keyof typeof AUDIT_SECTION_EVENT_TYPES;

function parseAuditSection(request: FastifyRequest): AuditSection | undefined {
  const query = request.query as Record<string, unknown>;
  const section = query.section;

  if (section === undefined || section === "" || section === "all") {
    return undefined;
  }

  if (section === "users" || section === "groups" || section === "applications") {
    return section;
  }

  throw new HttpError(400, "INVALID_QUERY", "section audit tidak valid");
}

function parseAuditDate(request: FastifyRequest, key: "from" | "to"): Date | undefined {
  const query = request.query as Record<string, unknown>;
  const value = query[key];

  if (value === undefined || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_QUERY", `${key} harus berupa waktu valid`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "INVALID_QUERY", `${key} harus berupa waktu valid`);
  }

  return date;
}

function parseAuditEventType(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, unknown>;
  const eventType = query.eventType;

  if (eventType === undefined || eventType === "" || eventType === "all") {
    return undefined;
  }

  if (typeof eventType !== "string") {
    throw new HttpError(400, "INVALID_QUERY", "eventType harus berupa string");
  }

  return eventType.trim();
}

function getActorId(request: FastifyRequest): string | undefined {
  const actorId = request.headers["x-actor-id"];

  if (typeof actorId !== "string") {
    return undefined;
  }

  try {
    return requireUuid(actorId, "x-actor-id");
  } catch {
    return undefined;
  }
}

function toMetadata(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

async function writeAudit(
  request: FastifyRequest,
  eventType: string,
  metadata: Record<string, unknown>,
  target: { userId?: string; applicationId?: string } = {}
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      eventType,
      actorId: getActorId(request),
      userId: target.userId,
      applicationId: target.applicationId,
      result: AuditResult.SUCCESS,
      metadata: toMetadata(metadata),
      ipAddress: request.ip
    }
  });
}

function assertHasUpdate(data: Record<string, unknown>): void {
  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "INVALID_BODY", "Minimal satu field harus diisi");
  }
}

async function userHasApplicationAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  applicationId: string
): Promise<boolean> {
  const [user, application] = await Promise.all([
    tx.user.findUnique({
      where: {
        id: userId
      },
      select: {
        status: true,
        groups: {
          select: {
            groupId: true
          }
        }
      }
    }),
    tx.application.findUnique({
      where: {
        id: applicationId
      },
      select: {
        status: true,
        policies: {
          where: {
            effect: PolicyEffect.ALLOW
          },
          select: {
            groupId: true
          }
        }
      }
    })
  ]);

  if (
    !user ||
    !application ||
    user.status !== UserStatus.ACTIVE ||
    application.status !== ApplicationStatus.ACTIVE
  ) {
    return false;
  }

  return hasAllowedGroup(
    application.policies.map((policy) => policy.groupId),
    user.groups.map((group) => group.groupId)
  );
}

async function createAccessPolicyChangedEventIfAccessLost(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    applicationId: string;
    payload: Prisma.InputJsonObject;
  }
): Promise<boolean> {
  if (await userHasApplicationAccess(tx, args.userId, args.applicationId)) {
    return false;
  }

  const revokedSessions = await revokeUserCentralSessions(
    tx,
    args.userId,
    "access_policy_changed"
  );

  if (revokedSessions.length === 0) {
    await createRevocationEvent(tx, {
      eventType: "AccessPolicyChanged",
      userId: args.userId,
      applicationId: args.applicationId,
      payload: args.payload,
      targetApplicationIds: [args.applicationId]
    });
  }

  for (const session of revokedSessions) {
    await createRevocationEvent(tx, {
      eventType: "AccessPolicyChanged",
      userId: args.userId,
      centralSessionId: session.id,
      applicationId: args.applicationId,
      payload: {
        ...args.payload,
        centralSessionId: session.id
      },
      targetApplicationIds: [args.applicationId]
    });
  }

  return true;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/summary", async () => {
    const [users, activeUsers, groups, applications, activeApplications, policies] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
        prisma.accessGroup.count(),
        prisma.application.count(),
        prisma.application.count({ where: { status: ApplicationStatus.ACTIVE } }),
        prisma.applicationGroupPolicy.count()
      ]);

    return {
      users: {
        total: users,
        active: activeUsers,
        inactive: users - activeUsers
      },
      groups: {
        total: groups
      },
      applications: {
        total: applications,
        active: activeApplications,
        inactive: applications - activeApplications
      },
      policies: {
        total: policies
      }
    };
  });

  app.get("/admin/users", async () => {
    return prisma.user.findMany({
      orderBy: {
        email: "asc"
      },
      select: USER_SELECT
    });
  });

  app.post("/admin/users", async (request, reply) => {
    const body = assertObjectBody(request.body);
    const password = requireString(body, "password");
    const user = await prisma.user.create({
      data: {
        name: requireString(body, "name"),
        email: requireString(body, "email").toLowerCase(),
        passwordHash: await hashSecret(password),
        status: parseUserStatus(body) ?? UserStatus.ACTIVE
      },
      select: USER_SELECT
    });

    await writeAudit(request, "AdminUserCreated", { user }, { userId: user.id });

    reply.status(201);
    return user;
  });

  app.patch("/admin/users/:id", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const data: {
      name?: string;
      email?: string;
      status?: UserStatus;
    } = {};
    const name = optionalString(body, "name");
    const email = optionalString(body, "email");
    const status = parseUserStatus(body);

    if (name) {
      data.name = name;
    }

    if (email) {
      data.email = email.toLowerCase();
    }

    if (status) {
      data.status = status;
    }

    assertHasUpdate(data);

    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data,
        select: USER_SELECT
      });

      if (data.status === UserStatus.INACTIVE) {
        const [targetApplicationIds, revokedSessions] = await Promise.all([
          getActiveApplicationIds(tx),
          revokeUserCentralSessions(tx, id, "user_inactive")
        ]);

        for (const session of revokedSessions) {
          await createRevocationEvent(tx, {
            eventType: "SessionRevoked",
            userId: id,
            centralSessionId: session.id,
            payload: {
              reason: "user_inactive",
              userId: id,
              centralSessionId: session.id
            },
            targetApplicationIds
          });
        }
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminUserUpdated",
          actorId: getActorId(request),
          userId: id,
          result: AuditResult.SUCCESS,
          metadata: toMetadata({ fields: Object.keys(data), user: updatedUser }),
          ipAddress: request.ip
        }
      });

      return updatedUser;
    });

    return user;
  });

  app.post("/admin/users/:id/password", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const passwordHash = await hashSecret(requireString(body, "password"));
    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { passwordHash },
        select: USER_SELECT
      });
      const [targetApplicationIds, revokedSessions] = await Promise.all([
        getActiveApplicationIds(tx),
        revokeUserCentralSessions(tx, id, "password_changed")
      ]);

      for (const session of revokedSessions) {
        await createRevocationEvent(tx, {
          eventType: "PasswordChanged",
          userId: id,
          centralSessionId: session.id,
          payload: {
            reason: "password_changed",
            userId: id,
            centralSessionId: session.id
          },
          targetApplicationIds
        });
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminUserPasswordChanged",
          actorId: getActorId(request),
          userId: id,
          result: AuditResult.SUCCESS,
          metadata: toMetadata({ userId: id, revokedSessions: revokedSessions.length }),
          ipAddress: request.ip
        }
      });

      return updatedUser;
    });

    return user;
  });

  app.get("/admin/groups", async () => {
    return prisma.accessGroup.findMany({
      orderBy: {
        name: "asc"
      },
      select: {
        ...GROUP_SELECT,
        users: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                status: true
              }
            }
          },
          orderBy: {
            user: {
              email: "asc"
            }
          }
        },
        policies: {
          select: {
            id: true,
            effect: true,
            application: {
              select: {
                id: true,
                name: true,
                clientId: true,
                status: true
              }
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    });
  });

  app.post("/admin/groups", async (request, reply) => {
    const body = assertObjectBody(request.body);
    const group = await prisma.accessGroup.create({
      data: {
        name: requireString(body, "name"),
        description: optionalString(body, "description")
      },
      select: GROUP_SELECT
    });

    await writeAudit(request, "AdminGroupCreated", { group });

    reply.status(201);
    return group;
  });

  app.patch("/admin/groups/:id", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const data: {
      name?: string;
      description?: string | null;
    } = {};
    const name = optionalString(body, "name");

    if (name) {
      data.name = name;
    }

    if ("description" in body) {
      data.description = optionalString(body, "description") ?? null;
    }

    assertHasUpdate(data);

    const group = await prisma.accessGroup.update({
      where: { id },
      data,
      select: GROUP_SELECT
    });

    await writeAudit(request, "AdminGroupUpdated", { fields: Object.keys(data), group });

    return group;
  });

  app.delete("/admin/groups/:id", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const group = await prisma.$transaction(async (tx) => {
      const targetGroup = await tx.accessGroup.findUniqueOrThrow({
        where: { id },
        select: GROUP_SELECT
      });
      const [memberships, policies] = await Promise.all([
        tx.userGroup.findMany({
          where: {
            groupId: id
          },
          select: {
            userId: true
          }
        }),
        tx.applicationGroupPolicy.findMany({
          where: {
            groupId: id
          },
          select: {
            applicationId: true
          }
        })
      ]);
      let affectedRevocations = 0;

      await tx.accessGroup.delete({
        where: { id }
      });

      for (const membership of memberships) {
        for (const policy of policies) {
          const eventCreated = await createAccessPolicyChangedEventIfAccessLost(tx, {
            userId: membership.userId,
            applicationId: policy.applicationId,
            payload: {
              reason: "group_deleted",
              userId: membership.userId,
              groupId: id,
              applicationId: policy.applicationId
            }
          });

          if (eventCreated) {
            affectedRevocations += 1;
          }
        }
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminGroupDeleted",
          actorId: getActorId(request),
          result: AuditResult.SUCCESS,
          metadata: toMetadata({
            group: targetGroup,
            affectedUsers: memberships.length,
            affectedApplications: policies.length,
            affectedRevocations
          }),
          ipAddress: request.ip
        }
      });

      return targetGroup;
    });

    return group;
  });

  app.post("/admin/groups/:id/users", async (request, reply) => {
    const groupId = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const userId = requireUuid(requireString(body, "userId"), "userId");
    const membership = await prisma.userGroup.upsert({
      where: {
        userId_groupId: {
          userId,
          groupId
        }
      },
      update: {},
      create: {
        userId,
        groupId
      },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true
          }
        },
        group: {
          select: GROUP_SELECT
        },
        createdAt: true
      }
    });

    await writeAudit(request, "AdminGroupUserAdded", { userId, groupId }, { userId });

    reply.status(201);
    return membership;
  });

  app.delete("/admin/groups/:id/users/:userId", async (request) => {
    const groupId = requireUuid(getParam(request, "id"), "id");
    const userId = requireUuid(getParam(request, "userId"), "userId");
    const membership = await prisma.$transaction(async (tx) => {
      const deletedMembership = await tx.userGroup.delete({
        where: {
          userId_groupId: {
            userId,
            groupId
          }
        },
        select: {
          id: true,
          userId: true,
          groupId: true
        }
      });
      const policies = await tx.applicationGroupPolicy.findMany({
        where: {
          groupId
        },
        select: {
          applicationId: true
        }
      });
      let affectedRevocations = 0;

      for (const policy of policies) {
        const eventCreated = await createAccessPolicyChangedEventIfAccessLost(tx, {
          userId,
          applicationId: policy.applicationId,
          payload: {
            reason: "group_membership_removed",
            userId,
            groupId,
            applicationId: policy.applicationId
          }
        });

        if (eventCreated) {
          affectedRevocations += 1;
        }
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminGroupUserRemoved",
          actorId: getActorId(request),
          userId,
          result: AuditResult.SUCCESS,
          metadata: toMetadata({ membership: deletedMembership, affectedRevocations }),
          ipAddress: request.ip
        }
      });

      return deletedMembership;
    });

    return membership;
  });

  app.get("/admin/applications", async () => {
    return prisma.application.findMany({
      orderBy: {
        clientId: "asc"
      },
      select: APPLICATION_SELECT
    });
  });

  app.post("/admin/applications", async (request, reply) => {
    const body = assertObjectBody(request.body);
    const clientSecret = optionalString(body, "clientSecret");
    const application = await prisma.application.create({
      data: {
        name: requireString(body, "name"),
        clientId: requireString(body, "clientId"),
        clientSecretHash: clientSecret ? await hashSecret(clientSecret) : undefined,
        status: parseApplicationStatus(body) ?? ApplicationStatus.ACTIVE,
        launchUrl: optionalString(body, "launchUrl"),
        logoutNotificationUrl: requireString(body, "logoutNotificationUrl")
      },
      select: APPLICATION_SELECT
    });

    await writeAudit(
      request,
      "AdminApplicationCreated",
      { application },
      { applicationId: application.id }
    );

    reply.status(201);
    return application;
  });

  app.patch("/admin/applications/:id", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const data: {
      name?: string;
      clientId?: string;
      clientSecretHash?: string | null;
      status?: ApplicationStatus;
      launchUrl?: string | null;
      logoutNotificationUrl?: string;
    } = {};
    const name = optionalString(body, "name");
    const clientId = optionalString(body, "clientId");
    const clientSecret = optionalString(body, "clientSecret");
    const status = parseApplicationStatus(body);
    const logoutNotificationUrl = optionalString(body, "logoutNotificationUrl");

    if (name) {
      data.name = name;
    }

    if (clientId) {
      data.clientId = clientId;
    }

    if ("clientSecret" in body) {
      data.clientSecretHash = clientSecret ? await hashSecret(clientSecret) : null;
    }

    if (status) {
      data.status = status;
    }

    if ("launchUrl" in body) {
      data.launchUrl = optionalString(body, "launchUrl") ?? null;
    }

    if (logoutNotificationUrl) {
      data.logoutNotificationUrl = logoutNotificationUrl;
    }

    assertHasUpdate(data);

    const application = await prisma.$transaction(async (tx) => {
      const previousApplication = await tx.application.findUniqueOrThrow({
        where: { id },
        select: {
          status: true,
          policies: {
            select: {
              groupId: true
            }
          }
        }
      });
      const updatedApplication = await tx.application.update({
        where: { id },
        data,
        select: APPLICATION_SELECT
      });
      let affectedRevocations = 0;

      if (
        data.status === ApplicationStatus.INACTIVE &&
        previousApplication.status !== ApplicationStatus.INACTIVE
      ) {
        const groupIds = previousApplication.policies.map((policy) => policy.groupId);

        if (groupIds.length > 0) {
          const memberships = await tx.userGroup.findMany({
            where: {
              groupId: {
                in: groupIds
              }
            },
            select: {
              userId: true
            }
          });
          const userIds = [...new Set(memberships.map((membership) => membership.userId))];

          for (const userId of userIds) {
            const eventCreated = await createAccessPolicyChangedEventIfAccessLost(tx, {
              userId,
              applicationId: id,
              payload: {
                reason: "application_inactive",
                userId,
                applicationId: id
              }
            });

            if (eventCreated) {
              affectedRevocations += 1;
            }
          }
        }
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminApplicationUpdated",
          actorId: getActorId(request),
          applicationId: id,
          result: AuditResult.SUCCESS,
          metadata: toMetadata({
            fields: Object.keys(data),
            application: updatedApplication,
            affectedRevocations
          }),
          ipAddress: request.ip
        }
      });

      return updatedApplication;
    });

    return application;
  });

  app.delete("/admin/applications/:id", async (request) => {
    const id = requireUuid(getParam(request, "id"), "id");
    const application = await prisma.application.findUniqueOrThrow({
      where: { id },
      select: APPLICATION_SELECT
    });

    await writeAudit(request, "AdminApplicationDeleted", { application }, { applicationId: id });

    await prisma.application.delete({
      where: { id }
    });

    return application;
  });

  app.post("/admin/applications/:id/redirect-uris", async (request, reply) => {
    const applicationId = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const redirectUri = await prisma.applicationRedirectUri.create({
      data: {
        applicationId,
        redirectUri: requireString(body, "redirectUri")
      },
      select: {
        id: true,
        applicationId: true,
        redirectUri: true,
        createdAt: true
      }
    });

    await writeAudit(
      request,
      "AdminApplicationRedirectUriCreated",
      { redirectUri },
      { applicationId }
    );

    reply.status(201);
    return redirectUri;
  });

  app.delete("/admin/applications/:id/redirect-uris/:redirectUriId", async (request) => {
    const applicationId = requireUuid(getParam(request, "id"), "id");
    const redirectUriId = requireUuid(getParam(request, "redirectUriId"), "redirectUriId");
    const redirectUri = await prisma.applicationRedirectUri.findFirst({
      where: {
        id: redirectUriId,
        applicationId
      },
      select: {
        id: true,
        applicationId: true,
        redirectUri: true
      }
    });

    if (!redirectUri) {
      throw new HttpError(404, "NOT_FOUND", "Redirect URI tidak ditemukan");
    }

    await prisma.applicationRedirectUri.delete({
      where: {
        id: redirectUriId
      }
    });

    await writeAudit(
      request,
      "AdminApplicationRedirectUriDeleted",
      { redirectUri },
      { applicationId }
    );

    return redirectUri;
  });

  app.patch("/admin/applications/:id/redirect-uris/:redirectUriId", async (request) => {
    const applicationId = requireUuid(getParam(request, "id"), "id");
    const redirectUriId = requireUuid(getParam(request, "redirectUriId"), "redirectUriId");
    const body = assertObjectBody(request.body);
    const redirectUriValue = requireString(body, "redirectUri");
    const existingRedirectUri = await prisma.applicationRedirectUri.findFirst({
      where: {
        id: redirectUriId,
        applicationId
      },
      select: {
        id: true,
        applicationId: true,
        redirectUri: true
      }
    });

    if (!existingRedirectUri) {
      throw new HttpError(404, "NOT_FOUND", "Redirect URI tidak ditemukan");
    }

    const redirectUri = await prisma.applicationRedirectUri.update({
      where: {
        id: redirectUriId
      },
      data: {
        redirectUri: redirectUriValue
      },
      select: {
        id: true,
        applicationId: true,
        redirectUri: true,
        createdAt: true
      }
    });

    await writeAudit(
      request,
      "AdminApplicationRedirectUriUpdated",
      { previousRedirectUri: existingRedirectUri, redirectUri },
      { applicationId }
    );

    return redirectUri;
  });

  app.post("/admin/applications/:id/policies", async (request, reply) => {
    const applicationId = requireUuid(getParam(request, "id"), "id");
    const body = assertObjectBody(request.body);
    const groupId = requireUuid(requireString(body, "groupId"), "groupId");
    const effect = parsePolicyEffect(body);
    const policy = await prisma.applicationGroupPolicy.upsert({
      where: {
        applicationId_groupId_effect: {
          applicationId,
          groupId,
          effect
        }
      },
      update: {},
      create: {
        applicationId,
        groupId,
        effect
      },
      select: {
        id: true,
        applicationId: true,
        effect: true,
        createdAt: true,
        group: {
          select: GROUP_SELECT
        }
      }
    });

    await writeAudit(request, "AdminApplicationPolicyCreated", { policy }, { applicationId });

    reply.status(201);
    return policy;
  });

  app.delete("/admin/applications/:id/policies/:policyId", async (request) => {
    const applicationId = requireUuid(getParam(request, "id"), "id");
    const policyId = requireUuid(getParam(request, "policyId"), "policyId");
    const policy = await prisma.applicationGroupPolicy.findFirst({
      where: {
        id: policyId,
        applicationId
      },
      select: {
        id: true,
        applicationId: true,
        groupId: true,
        effect: true
      }
    });

    if (!policy) {
      throw new HttpError(404, "NOT_FOUND", "Policy tidak ditemukan");
    }

    await prisma.$transaction(async (tx) => {
      await tx.applicationGroupPolicy.delete({
        where: {
          id: policyId
        }
      });
      const memberships = await tx.userGroup.findMany({
        where: {
          groupId: policy.groupId
        },
        select: {
          userId: true
        }
      });
      let affectedRevocations = 0;

      for (const membership of memberships) {
        const eventCreated = await createAccessPolicyChangedEventIfAccessLost(tx, {
          userId: membership.userId,
          applicationId,
          payload: {
            reason: "application_policy_deleted",
            userId: membership.userId,
            groupId: policy.groupId,
            applicationId
          }
        });

        if (eventCreated) {
          affectedRevocations += 1;
        }
      }

      await tx.auditLog.create({
        data: {
          eventType: "AdminApplicationPolicyDeleted",
          actorId: getActorId(request),
          applicationId,
          result: AuditResult.SUCCESS,
          metadata: toMetadata({ policy, affectedUsers: memberships.length, affectedRevocations }),
          ipAddress: request.ip
        }
      });
    });

    return policy;
  });

  app.get("/admin/audit-logs", async (request) => {
    const section = parseAuditSection(request);
    const eventType = parseAuditEventType(request);
    const from = parseAuditDate(request, "from");
    const to = parseAuditDate(request, "to");
    const filters: Prisma.AuditLogWhereInput[] = [];

    if (from && to && from > to) {
      throw new HttpError(400, "INVALID_QUERY", "from tidak boleh lebih baru dari to");
    }

    if (section) {
      filters.push({
        eventType: {
          in: [...AUDIT_SECTION_EVENT_TYPES[section]]
        }
      });
    }

    if (eventType) {
      filters.push({
        eventType
      });
    }

    if (from || to) {
      filters.push({
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {})
        }
      });
    }

    return prisma.auditLog.findMany({
      take: parseLimit(request),
      where: filters.length > 0 ? { AND: filters } : undefined,
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        eventType: true,
        actorId: true,
        userId: true,
        applicationId: true,
        sessionId: true,
        result: true,
        metadata: true,
        ipAddress: true,
        createdAt: true
      }
    });
  });

  app.get("/admin/events", async (request) => {
    return prisma.event.findMany({
      take: parseLimit(request),
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        eventType: true,
        userId: true,
        centralSessionId: true,
        applicationId: true,
        payload: true,
        status: true,
        createdAt: true,
        publishedAt: true
      }
    });
  });

  app.get("/admin/event-deliveries", async (request) => {
    return prisma.eventDelivery.findMany({
      take: parseLimit(request),
      select: {
        id: true,
        eventId: true,
        applicationId: true,
        status: true,
        attemptCount: true,
        lastAttemptAt: true,
        nextRetryAt: true,
        processedAt: true,
        lastError: true
      }
    });
  });
}

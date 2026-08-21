import { randomUUID } from "node:crypto";
import {
  ApplicationStatus,
  DeliveryStatus,
  EventStatus,
  Prisma,
  SessionStatus,
  TokenStatus
} from "../../generated/prisma/client.js";

type TransactionClient = Prisma.TransactionClient;

type RevocationEventInput = {
  eventType: "SessionRevoked" | "PasswordChanged" | "AccessPolicyChanged";
  userId: string;
  centralSessionId?: string;
  applicationId?: string;
  payload: Prisma.InputJsonObject;
  targetApplicationIds: string[];
};

export async function getActiveApplicationIds(tx: TransactionClient): Promise<string[]> {
  const applications = await tx.application.findMany({
    where: {
      status: ApplicationStatus.ACTIVE
    },
    select: {
      id: true
    }
  });

  return applications.map((application) => application.id);
}

export async function createRevocationEvent(
  tx: TransactionClient,
  input: RevocationEventInput
): Promise<void> {
  const targetApplicationIds = [...new Set(input.targetApplicationIds)];

  if (targetApplicationIds.length === 0) {
    return;
  }

  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();

  await tx.event.create({
    data: {
      id: eventId,
      eventType: input.eventType,
      userId: input.userId,
      centralSessionId: input.centralSessionId,
      applicationId: input.applicationId,
      payload: {
        ...input.payload,
        eventId,
        eventType: input.eventType,
        userId: input.userId,
        ...(input.centralSessionId ? { centralSessionId: input.centralSessionId } : {}),
        ...(input.applicationId ? { applicationId: input.applicationId } : {}),
        occurredAt,
        metadata: {}
      },
      status: EventStatus.PENDING,
      deliveries: {
        create: targetApplicationIds.map((applicationId) => ({
          applicationId,
          status: DeliveryStatus.PENDING
        }))
      }
    }
  });
}

export async function revokeUserCentralSessions(
  tx: TransactionClient,
  userId: string,
  reason: "password_changed" | "user_inactive" | "access_policy_changed"
): Promise<Array<{ id: string }>> {
  const sessions = await tx.ssoSession.findMany({
    where: {
      userId,
      status: SessionStatus.ACTIVE
    },
    select: {
      id: true
    }
  });

  if (sessions.length === 0) {
    return [];
  }

  const sessionIds = sessions.map((session) => session.id);

  await tx.ssoSession.updateMany({
    where: {
      id: {
        in: sessionIds
      }
    },
    data: {
      status: SessionStatus.REVOKED,
      revokedAt: new Date(),
      revokeReason: reason
    }
  });

  await tx.accessToken.updateMany({
    where: {
      ssoSessionId: {
        in: sessionIds
      },
      status: TokenStatus.ACTIVE
    },
    data: {
      status: TokenStatus.REVOKED,
      revokedAt: new Date()
    }
  });

  return sessions;
}

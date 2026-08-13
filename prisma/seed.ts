import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ApplicationStatus,
  PolicyEffect,
  PrismaClient,
  UserStatus
} from "../generated/prisma/client.js";

const scrypt = promisify(scryptCallback);

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run seed");
  }

  return databaseUrl;
}

async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(value, salt, 64)) as Buffer;

  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

const adapter = new PrismaPg({
  connectionString: getDatabaseUrl()
});

const prisma = new PrismaClient({
  adapter
});

async function main(): Promise<void> {
  const defaultPasswordHash = await hashSecret("password123");
  const clientSecretHash = await hashSecret("client-secret");

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      name: "Admin User",
      status: UserStatus.ACTIVE
    },
    create: {
      name: "Admin User",
      email: "admin@example.com",
      passwordHash: defaultPasswordHash,
      status: UserStatus.ACTIVE
    }
  });

  const appAGroup = await prisma.accessGroup.upsert({
    where: { name: "app-a-users" },
    update: {},
    create: {
      name: "app-a-users",
      description: "Users allowed to access App A"
    }
  });

  const appBGroup = await prisma.accessGroup.upsert({
    where: { name: "app-b-users" },
    update: {},
    create: {
      name: "app-b-users",
      description: "Users allowed to access App B"
    }
  });

  const appAUser = await prisma.user.upsert({
    where: { email: "app-a-user@example.com" },
    update: {
      name: "App A User",
      status: UserStatus.ACTIVE
    },
    create: {
      name: "App A User",
      email: "app-a-user@example.com",
      passwordHash: defaultPasswordHash,
      status: UserStatus.ACTIVE
    }
  });

  const appBUser = await prisma.user.upsert({
    where: { email: "app-b-user@example.com" },
    update: {
      name: "App B User",
      status: UserStatus.ACTIVE
    },
    create: {
      name: "App B User",
      email: "app-b-user@example.com",
      passwordHash: defaultPasswordHash,
      status: UserStatus.ACTIVE
    }
  });

  const bothAppsUser = await prisma.user.upsert({
    where: { email: "both-apps-user@example.com" },
    update: {
      name: "Both Apps User",
      status: UserStatus.ACTIVE
    },
    create: {
      name: "Both Apps User",
      email: "both-apps-user@example.com",
      passwordHash: defaultPasswordHash,
      status: UserStatus.ACTIVE
    }
  });

  await prisma.user.upsert({
    where: { email: "inactive-user@example.com" },
    update: {
      name: "Inactive User",
      status: UserStatus.INACTIVE
    },
    create: {
      name: "Inactive User",
      email: "inactive-user@example.com",
      passwordHash: defaultPasswordHash,
      status: UserStatus.INACTIVE
    }
  });

  for (const [userId, groupId] of [
    [appAUser.id, appAGroup.id],
    [appBUser.id, appBGroup.id],
    [bothAppsUser.id, appAGroup.id],
    [bothAppsUser.id, appBGroup.id]
  ]) {
    await prisma.userGroup.upsert({
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
      }
    });
  }

  const appA = await prisma.application.upsert({
    where: { clientId: "app-a" },
    update: {
      name: "App A",
      status: ApplicationStatus.ACTIVE,
      launchUrl: "http://localhost:3001",
      logoutNotificationUrl: "http://app-a:3001/internal/logout"
    },
    create: {
      name: "App A",
      clientId: "app-a",
      clientSecretHash,
      status: ApplicationStatus.ACTIVE,
      launchUrl: "http://localhost:3001",
      logoutNotificationUrl: "http://app-a:3001/internal/logout"
    }
  });

  const appB = await prisma.application.upsert({
    where: { clientId: "app-b" },
    update: {
      name: "App B",
      status: ApplicationStatus.ACTIVE,
      launchUrl: "http://localhost:3002",
      logoutNotificationUrl: "http://app-b:3002/internal/logout"
    },
    create: {
      name: "App B",
      clientId: "app-b",
      clientSecretHash,
      status: ApplicationStatus.ACTIVE,
      launchUrl: "http://localhost:3002",
      logoutNotificationUrl: "http://app-b:3002/internal/logout"
    }
  });

  for (const [applicationId, redirectUri] of [
    [appA.id, "http://localhost:3001/callback"],
    [appB.id, "http://localhost:3002/callback"]
  ]) {
    await prisma.applicationRedirectUri.upsert({
      where: {
        applicationId_redirectUri: {
          applicationId,
          redirectUri
        }
      },
      update: {},
      create: {
        applicationId,
        redirectUri
      }
    });
  }

  for (const [applicationId, groupId] of [
    [appA.id, appAGroup.id],
    [appB.id, appBGroup.id]
  ]) {
    await prisma.applicationGroupPolicy.upsert({
      where: {
        applicationId_groupId_effect: {
          applicationId,
          groupId,
          effect: PolicyEffect.ALLOW
        }
      },
      update: {},
      create: {
        applicationId,
        groupId,
        effect: PolicyEffect.ALLOW
      }
    });
  }
}

await main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

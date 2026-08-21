import type { FastifyInstance, FastifyReply } from "fastify";

type ReadinessCheck = {
  name: string;
  check: () => Promise<void>;
};

type HealthOptions = {
  service: string;
  readinessChecks?: ReadinessCheck[];
  details?: () => Record<string, unknown>;
};

type PrismaHealthClient = {
  $queryRaw: <T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<T>;
};

export async function checkDatabase(prisma: PrismaHealthClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthOptions
): void {
  app.get("/health", async () => ({
    service: options.service,
    status: "ok",
    ...(options.details ? options.details() : {})
  }));

  app.get("/health/live", async () => ({
    service: options.service,
    status: "ok"
  }));

  app.get("/health/ready", async (_, reply: FastifyReply) => {
    const checks = await Promise.all(
      (options.readinessChecks ?? []).map(async (readinessCheck) => {
        try {
          await readinessCheck.check();

          return {
            name: readinessCheck.name,
            status: "ok"
          };
        } catch (error) {
          return {
            name: readinessCheck.name,
            status: "error",
            error: "Dependency unavailable"
          };
        }
      })
    );
    const ready = checks.every((check) => check.status === "ok");

    if (!ready) {
      reply.status(503);
    }

    return {
      service: options.service,
      status: ready ? "ok" : "error",
      checks,
      ...(options.details ? options.details() : {})
    };
  });
}

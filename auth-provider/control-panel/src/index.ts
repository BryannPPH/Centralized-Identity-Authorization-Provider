import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import { checkDatabase, registerHealthRoutes } from "../../../shared/health.js";
import { installGracefulShutdown } from "../../shared/lifecycle.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { ADMIN_HTML } from "./admin-ui.js";
import { prisma } from "./db.js";
import { HttpError, sendError, sendNotFound } from "./http.js";

const app = Fastify({
  logger: true
});

const port = Number(process.env.PORT ?? 3004);
const host = process.env.HOST ?? "0.0.0.0";
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header || !header.startsWith("Basic ")) {
    return null;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");

  if (separator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function isHealthRoute(url: string): boolean {
  return url === "/health" || url === "/health/live" || url === "/health/ready";
}

function requireSameOrigin(request: FastifyRequest): void {
  if (!["POST", "PATCH", "DELETE"].includes(request.method)) {
    return;
  }

  const origin = request.headers.origin;
  const host = request.headers.host;

  if (!origin || !host || ![`http://${host}`, `https://${host}`].includes(origin)) {
    throw new HttpError(403, "CSRF_ORIGIN_INVALID", "Origin request tidak valid");
  }
}

registerHealthRoutes(app, {
  service: "control-panel",
  readinessChecks: [
    {
      name: "database",
      check: () => checkDatabase(prisma)
    }
  ]
});

app.addHook("onRequest", async (request, reply) => {
  if (isHealthRoute(request.url)) {
    return;
  }

  const credentials = parseBasicAuth(request.headers.authorization);
  const expectedUsername = requireEnv(adminUsername, "ADMIN_USERNAME");
  const expectedPassword = requireEnv(adminPassword, "ADMIN_PASSWORD");

  if (
    !credentials ||
    !safeEqual(credentials.username, expectedUsername) ||
    !safeEqual(credentials.password, expectedPassword)
  ) {
    reply.header("www-authenticate", "Basic realm=\"Control Panel\"");
    throw new HttpError(401, "UNAUTHORIZED", "Admin credentials tidak valid");
  }

  requireSameOrigin(request);
});

app.get("/", async (_, reply) => {
  reply.type("text/html; charset=utf-8");
  return ADMIN_HTML;
});

app.setErrorHandler(sendError);
app.setNotFoundHandler(sendNotFound);

await registerAdminRoutes(app);

installGracefulShutdown({
  app,
  cleanup: () => prisma.$disconnect()
});

await app.listen({ port, host });

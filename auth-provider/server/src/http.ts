import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function assertObjectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "INVALID_BODY", "Request body harus berupa object JSON");
  }

  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "INVALID_BODY", `${key} wajib diisi`);
  }

  return value.trim();
}

function getPrismaCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" ? code : undefined;
}

export function sendError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof HttpError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.id
      }
    });
    return;
  }

  const prismaCode = getPrismaCode(error);

  if (prismaCode === "P2025") {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Data tidak ditemukan",
        requestId: request.id
      }
    });
    return;
  }

  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code ?? "BAD_REQUEST",
        message: error.message,
        requestId: request.id
      }
    });
    return;
  }

  request.log.error(error);
  reply.status(500).send({
    error: {
      code: "INTERNAL_ERROR",
      message: "Terjadi kesalahan server",
      requestId: request.id
    }
  });
}

export function sendNotFound(request: FastifyRequest, reply: FastifyReply): void {
  reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint tidak ditemukan",
      requestId: request.id
    }
  });
}

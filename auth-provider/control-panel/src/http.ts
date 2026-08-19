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

export function getParam(request: FastifyRequest, name: string): string {
  const params = request.params as Record<string, unknown>;
  const value = params[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "INVALID_PARAM", `Parameter ${name} tidak valid`);
  }

  return value;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "INVALID_BODY", `${key} wajib diisi`);
  }

  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_BODY", `${key} harus berupa string`);
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function requireUuid(value: string, name: string): string {
  if (!isUuid(value)) {
    throw new HttpError(400, "INVALID_PARAM", `${name} harus UUID valid`);
  }

  return value;
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

  if (prismaCode === "P2002") {
    reply.status(409).send({
      error: {
        code: "CONFLICT",
        message: "Data unik sudah digunakan",
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

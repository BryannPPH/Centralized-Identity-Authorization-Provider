import Fastify from "fastify";
import { checkDatabase, registerHealthRoutes } from "../../../shared/health.js";
import { installGracefulShutdown } from "../../shared/lifecycle.js";
import { prisma } from "./db.js";
import { startWorker, workerStatus } from "./worker.js";

const app = Fastify({
  logger: true
});

const port = Number(process.env.PORT ?? 3003);
const host = process.env.HOST ?? "0.0.0.0";

registerHealthRoutes(app, {
  service: "sync-worker",
  readinessChecks: [
    {
      name: "database",
      check: () => checkDatabase(prisma)
    },
    {
      name: "rabbitmq",
      check: async () => {
        if (!workerStatus.rabbitmqConnected) {
          throw new Error("RabbitMQ connection is not active");
        }
      }
    }
  ],
  details: () => ({
    worker: {
      rabbitmqConnected: workerStatus.rabbitmqConnected,
      publisherRunning: workerStatus.publisherRunning,
      consumerRunning: workerStatus.consumerRunning
    }
  })
});

app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint tidak ditemukan",
      requestId: request.id
    }
  });
});

const abortController = new AbortController();

const worker = await startWorker(abortController.signal);

installGracefulShutdown({
  app,
  cleanup: async () => {
    abortController.abort();
    await worker.close();
    await prisma.$disconnect();
  }
});

await app.listen({ port, host });

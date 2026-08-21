import Fastify from "fastify";
import { connect } from "amqplib";
import { DeliveryStatus } from "../../../generated/prisma/client.js";
import { checkDatabase, registerHealthRoutes } from "../../../shared/health.js";
import { installGracefulShutdown } from "../../shared/lifecycle.js";
import { registerMetricsRoutes } from "../../shared/metrics.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { prisma } from "./db.js";
import { sendError, sendNotFound } from "./http.js";
import { registerOAuthRoutes } from "./oauth-routes.js";

const app = Fastify({
  logger: true
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

async function checkRabbitMq(): Promise<void> {
  const rabbitMqUrl = process.env.RABBITMQ_URL;

  if (!rabbitMqUrl) {
    throw new Error("RABBITMQ_URL is required");
  }

  const connection = await connect(rabbitMqUrl);
  await connection.close();
}

registerHealthRoutes(app, {
  service: "auth-provider-server",
  readinessChecks: [
    {
      name: "database",
      check: () => checkDatabase(prisma)
    },
    {
      name: "rabbitmq",
      check: checkRabbitMq
    }
  ]
});

registerMetricsRoutes(app, {
  service: "auth-provider-server",
  collect: async () => {
    const deliveries = await prisma.eventDelivery.groupBy({
      by: ["status"],
      _count: {
        _all: true
      }
    });
    const metrics: Record<string, number> = {
      identity_event_deliveries_pending: 0,
      identity_event_deliveries_processing: 0,
      identity_event_deliveries_retrying: 0,
      identity_event_deliveries_failed: 0,
      identity_event_deliveries_succeeded: 0
    };

    for (const delivery of deliveries) {
      metrics[`identity_event_deliveries_${delivery.status.toLowerCase()}`] =
        delivery._count._all;
    }

    metrics.identity_event_delivery_backlog =
      metrics[`identity_event_deliveries_${DeliveryStatus.PENDING.toLowerCase()}`] +
      metrics[`identity_event_deliveries_${DeliveryStatus.PROCESSING.toLowerCase()}`] +
      metrics[`identity_event_deliveries_${DeliveryStatus.RETRYING.toLowerCase()}`];

    return metrics;
  }
});

app.setErrorHandler(sendError);
app.setNotFoundHandler(sendNotFound);

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

await registerAuthRoutes(app);
await registerOAuthRoutes(app);

installGracefulShutdown({
  app,
  cleanup: () => prisma.$disconnect()
});

await app.listen({ port, host });

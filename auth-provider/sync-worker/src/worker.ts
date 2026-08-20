import { setTimeout as delay } from "node:timers/promises";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage
} from "amqplib";
import {
  DeliveryStatus,
  EventStatus
} from "../../../generated/prisma/client.js";
import { prisma } from "./db.js";

const QUEUE_NAME = process.env.REVOCATION_QUEUE_NAME ?? "revocation.deliveries";
const DLQ_NAME = process.env.REVOCATION_DLQ_NAME ?? "revocation.deliveries.dlq";
const PUBLISH_INTERVAL_MS = Number(process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? 1000);
const MAX_DELIVERY_ATTEMPTS = Number(process.env.MAX_DELIVERY_ATTEMPTS ?? 5);
const PROCESSING_TIMEOUT_MS = Number(process.env.PROCESSING_TIMEOUT_MS ?? 5 * 60 * 1000);
const INTERNAL_LOGOUT_TOKEN = process.env.INTERNAL_LOGOUT_TOKEN;
const RABBITMQ_URL = process.env.RABBITMQ_URL;

type WorkerStatus = {
  rabbitmqConnected: boolean;
  publisherRunning: boolean;
  consumerRunning: boolean;
  lastPublisherError?: string;
  lastConsumerError?: string;
};

type DeliveryMessage = {
  deliveryId: string;
};

type WorkerHandle = {
  close: () => Promise<void>;
};

export const workerStatus: WorkerStatus = {
  rabbitmqConnected: false,
  publisherRunning: false,
  consumerRunning: false
};

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getRetryTime(attemptCount: number): Date {
  const delaySeconds = Math.min(2 ** Math.max(attemptCount - 1, 0), 60);

  return new Date(Date.now() + delaySeconds * 1000);
}

function getProcessingCutoff(): Date {
  return new Date(Date.now() - PROCESSING_TIMEOUT_MS);
}

async function createChannel(): Promise<{ connection: ChannelModel; channel: ConfirmChannel }> {
  const connection = await connect(requireEnv(RABBITMQ_URL, "RABBITMQ_URL"));
  const channel = await connection.createConfirmChannel();

  await channel.assertQueue(QUEUE_NAME, {
    durable: true
  });
  await channel.assertQueue(DLQ_NAME, {
    durable: true
  });
  await channel.prefetch(1);

  connection.on("close", () => {
    workerStatus.rabbitmqConnected = false;
  });
  connection.on("error", (error) => {
    workerStatus.rabbitmqConnected = false;
    workerStatus.lastConsumerError = serializeError(error);
  });

  workerStatus.rabbitmqConnected = true;

  return {
    connection,
    channel
  };
}

async function publishEligibleDeliveries(channel: ConfirmChannel): Promise<void> {
  await prisma.eventDelivery.updateMany({
    where: {
      status: DeliveryStatus.PROCESSING,
      lastAttemptAt: {
        lt: getProcessingCutoff()
      }
    },
    data: {
      status: DeliveryStatus.RETRYING,
      nextRetryAt: null,
      lastError: "Recovered stale processing delivery"
    }
  });

  const deliveries = await prisma.eventDelivery.findMany({
    where: {
      OR: [
        {
          status: DeliveryStatus.PENDING
        },
        {
          status: DeliveryStatus.RETRYING,
          OR: [
            {
              nextRetryAt: null
            },
            {
              nextRetryAt: {
                lte: new Date()
              }
            }
          ]
        }
      ]
    },
    take: 20,
    orderBy: {
      lastAttemptAt: "asc"
    },
    select: {
      id: true,
      status: true
    }
  });

  for (const delivery of deliveries) {
    const locked = await prisma.eventDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status
      },
      data: {
        status: DeliveryStatus.PROCESSING,
        lastAttemptAt: new Date(),
        nextRetryAt: null
      }
    });

    if (locked.count !== 1) {
      continue;
    }

    channel.sendToQueue(
      QUEUE_NAME,
      Buffer.from(JSON.stringify({ deliveryId: delivery.id } satisfies DeliveryMessage)),
      {
        contentType: "application/json",
        persistent: true
      }
    );
    await channel.waitForConfirms();

    await prisma.eventDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        event: {
          update: {
            status: EventStatus.PUBLISHED,
            publishedAt: new Date()
          }
        }
      }
    });
  }
}

async function markEventTerminal(eventId: string): Promise<void> {
  const [pending, failed] = await Promise.all([
    prisma.eventDelivery.count({
      where: {
        eventId,
        status: {
          in: [DeliveryStatus.PENDING, DeliveryStatus.PROCESSING, DeliveryStatus.RETRYING]
        }
      }
    }),
    prisma.eventDelivery.count({
      where: {
        eventId,
        status: DeliveryStatus.FAILED
      }
    })
  ]);

  if (pending > 0) {
    return;
  }

  await prisma.event.update({
    where: {
      id: eventId
    },
    data: {
      status: failed > 0 ? EventStatus.DEAD_LETTERED : EventStatus.PROCESSED
    }
  });
}

async function callInternalLogout(deliveryId: string): Promise<void> {
  const delivery = await prisma.eventDelivery.findUnique({
    where: {
      id: deliveryId
    },
    select: {
      id: true,
      attemptCount: true,
      status: true,
      application: {
        select: {
          logoutNotificationUrl: true
        }
      },
      event: {
        select: {
          id: true,
          eventType: true,
          userId: true,
          centralSessionId: true,
          applicationId: true,
          createdAt: true,
          payload: true
        }
      }
    }
  });

  if (!delivery || delivery.status === DeliveryStatus.SUCCEEDED) {
    return;
  }

  const response = await fetch(delivery.application.logoutNotificationUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": requireEnv(INTERNAL_LOGOUT_TOKEN, "INTERNAL_LOGOUT_TOKEN")
    },
    body: JSON.stringify({
      eventId: delivery.event.id,
      eventType: delivery.event.eventType,
      userId: delivery.event.userId,
      centralSessionId: delivery.event.centralSessionId,
      applicationId: delivery.event.applicationId,
      reason:
        delivery.event.payload &&
        typeof delivery.event.payload === "object" &&
        !Array.isArray(delivery.event.payload) &&
        "reason" in delivery.event.payload &&
        typeof delivery.event.payload.reason === "string"
          ? delivery.event.payload.reason
          : undefined,
      occurredAt: delivery.event.createdAt.toISOString(),
      payload: delivery.event.payload
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Internal logout failed with ${response.status}: ${text}`);
  }

  await prisma.eventDelivery.update({
    where: {
      id: delivery.id
    },
    data: {
      status: DeliveryStatus.SUCCEEDED,
      processedAt: new Date(),
      lastError: null
    }
  });
  await markEventTerminal(delivery.event.id);
}

async function handleDeliveryFailure(
  channel: ConfirmChannel,
  deliveryId: string,
  error: unknown
): Promise<void> {
  const delivery = await prisma.eventDelivery.findUnique({
    where: {
      id: deliveryId
    },
    select: {
      id: true,
      eventId: true,
      attemptCount: true
    }
  });

  if (!delivery) {
    return;
  }

  const attemptCount = delivery.attemptCount + 1;
  const errorMessage = serializeError(error).slice(0, 1000);

  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    await prisma.eventDelivery.update({
      where: {
        id: delivery.id
      },
      data: {
        status: DeliveryStatus.FAILED,
        attemptCount,
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        lastError: errorMessage
      }
    });
    channel.sendToQueue(
      DLQ_NAME,
      Buffer.from(JSON.stringify({ deliveryId: delivery.id, error: errorMessage })),
      {
        contentType: "application/json",
        persistent: true
      }
    );
    await channel.waitForConfirms();
    await markEventTerminal(delivery.eventId);
    return;
  }

  await prisma.eventDelivery.update({
    where: {
      id: delivery.id
    },
    data: {
      status: DeliveryStatus.RETRYING,
      attemptCount,
      lastAttemptAt: new Date(),
      nextRetryAt: getRetryTime(attemptCount),
      lastError: errorMessage
    }
  });
}

function parseDeliveryMessage(message: ConsumeMessage): DeliveryMessage {
  const parsed = JSON.parse(message.content.toString()) as unknown;

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { deliveryId?: unknown }).deliveryId !== "string"
  ) {
    throw new Error("Invalid delivery message");
  }

  return parsed as DeliveryMessage;
}

async function startPublisher(channel: ConfirmChannel, signal: AbortSignal): Promise<void> {
  workerStatus.publisherRunning = true;

  while (!signal.aborted) {
    try {
      await publishEligibleDeliveries(channel);
      workerStatus.lastPublisherError = undefined;
    } catch (error) {
      workerStatus.lastPublisherError = serializeError(error);
    }

    await delay(PUBLISH_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
  }

  workerStatus.publisherRunning = false;
}

async function startConsumer(
  channel: ConfirmChannel,
  inFlight: Set<Promise<void>>
): Promise<string> {
  workerStatus.consumerRunning = true;

  const consumer = await channel.consume(QUEUE_NAME, (message) => {
    if (!message) {
      return;
    }

    const task = (async () => {
      try {
        const parsedMessage = parseDeliveryMessage(message);
        await callInternalLogout(parsedMessage.deliveryId);
        channel.ack(message);
        workerStatus.lastConsumerError = undefined;
      } catch (error) {
        workerStatus.lastConsumerError = serializeError(error);

        try {
          const parsedMessage = parseDeliveryMessage(message);
          await handleDeliveryFailure(channel, parsedMessage.deliveryId, error);
          workerStatus.lastConsumerError = undefined;
          channel.ack(message);
        } catch (failureError) {
          workerStatus.lastConsumerError = serializeError(failureError);
          channel.ack(message);
        }
      }
    })();

    inFlight.add(task);
    void task.finally(() => {
      inFlight.delete(task);
    });
  });

  return consumer.consumerTag;
}

export async function startWorker(signal: AbortSignal): Promise<WorkerHandle> {
  const { connection, channel } = await createChannel();
  const internalAbortController = new AbortController();
  const inFlight = new Set<Promise<void>>();
  let closed = false;

  const forwardAbort = (): void => {
    internalAbortController.abort();
  };

  signal.addEventListener("abort", forwardAbort, { once: true });

  const publisher = startPublisher(channel, internalAbortController.signal);
  const consumerTag = await startConsumer(channel, inFlight);

  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }

    closed = true;
    internalAbortController.abort();
    signal.removeEventListener("abort", forwardAbort);

    await channel.cancel(consumerTag).catch(() => undefined);
    workerStatus.consumerRunning = false;
    await Promise.allSettled([...inFlight]);
    await publisher.catch(() => undefined);
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
    workerStatus.rabbitmqConnected = false;
    workerStatus.publisherRunning = false;
  };

  signal.addEventListener("abort", () => {
    void close();
  }, { once: true });

  return {
    close
  };
}

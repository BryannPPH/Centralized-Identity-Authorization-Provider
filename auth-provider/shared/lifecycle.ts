import type { FastifyInstance } from "fastify";

type GracefulShutdownOptions = {
  app: FastifyInstance;
  cleanup?: () => Promise<void>;
};

export function installGracefulShutdown(options: GracefulShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    options.app.log.info({ signal }, "Graceful shutdown started");

    try {
      await options.app.close();
      await options.cleanup?.();
      options.app.log.info({ signal }, "Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      options.app.log.error({ error, signal }, "Graceful shutdown failed");
      process.exit(1);
    }
  };

  process.once("SIGINT", (signal) => {
    void shutdown(signal);
  });
  process.once("SIGTERM", (signal) => {
    void shutdown(signal);
  });
}

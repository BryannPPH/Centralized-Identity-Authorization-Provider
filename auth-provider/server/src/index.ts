import Fastify from "fastify";

const app = Fastify({
  logger: true
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.get("/health", async () => {
  return {
    service: "auth-provider-server",
    status: "ok"
  };
});

await app.listen({ port, host });

import Fastify from "fastify";
import { installGracefulShutdown } from "../../../auth-provider/shared/lifecycle.js";
import { getRelyingAppConfig, registerRelyingApp } from "../../shared/relying-app.js";

const app = Fastify({
  logger: true
});

const config = getRelyingAppConfig({
  applicationId: "app-a",
  displayName: "App A",
  port: 3001
});

await registerRelyingApp(app, config);
installGracefulShutdown({ app });
await app.listen({ port: config.port, host: config.host });

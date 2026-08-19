import Fastify from "fastify";
import { installGracefulShutdown } from "../../../auth-provider/shared/lifecycle.js";
import { getRelyingAppConfig, registerRelyingApp } from "../../shared/relying-app.js";

const app = Fastify({
  logger: true
});

const config = getRelyingAppConfig({
  applicationId: "app-b",
  displayName: "App B",
  port: 3002
});

await registerRelyingApp(app, config);
installGracefulShutdown({ app });
await app.listen({ port: config.port, host: config.host });

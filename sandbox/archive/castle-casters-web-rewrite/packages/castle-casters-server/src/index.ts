import * as Sentry from "@sentry/bun";
import { createApp, setUpgradeHandler } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();

if (config.sentryDsn !== undefined) {
  Sentry.init({ dsn: config.sentryDsn });
}

const runtime = createApp();

const server = Bun.serve({
  port: config.port,
  fetch(request, serverInstance) {
    setUpgradeHandler((upgradeRequest, options) => {
      const upgraded = serverInstance.upgrade(upgradeRequest, options);
      return upgraded;
    });
    return runtime.app.fetch(request);
  },
  websocket: runtime.websocket,
});

console.log(`Castle Casters server listening on ${String(server.port)}`);

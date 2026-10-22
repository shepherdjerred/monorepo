import { createHandler } from "./app.ts";
import { loadConfig } from "./config.ts";
import { initializeBugsink } from "./bugsink.ts";
import { initializeDynamicConfig } from "./dynamic-config.ts";

// Initialize before anything else so early failures are captured.
initializeBugsink();

await initializeDynamicConfig({ environment: Bun.env });

const config = loadConfig(Bun.env);
const handler = createHandler(config);

const server = Bun.serve({
  port: config.port,
  fetch: handler,
});

if (server.port === undefined) {
  throw new Error("trmnl-dashboard did not bind a TCP port");
}

console.log(`trmnl-dashboard listening on :${server.port.toString()}`);

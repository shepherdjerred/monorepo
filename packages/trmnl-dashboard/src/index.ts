import { createHandler } from "./app.ts";
import { loadConfig } from "./config.ts";
import { initializeSentry } from "./sentry.ts";
import { initializeDynamicConfig } from "./dynamic-config.ts";

// Initialize before anything else so early failures are captured.
initializeSentry();

await initializeDynamicConfig({ environment: Bun.env });

const config = loadConfig(Bun.env);
const handler = createHandler(config);

Bun.serve({
  port: config.port,
  fetch: handler,
});

console.log(`trmnl-dashboard listening on :${config.port.toString()}`);

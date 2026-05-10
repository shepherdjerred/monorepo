import { createHandler } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig(Bun.env);
const handler = createHandler(config);

Bun.serve({
  port: config.port,
  fetch: handler,
});

console.log(`trmnl-dashboard listening on :${config.port.toString()}`);

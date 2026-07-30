import { seedEndToEndStore } from "./fixtures.ts";

import { createApp } from "#server/app.ts";
import { createEvalStore } from "#server/store.ts";

const store = createEvalStore(":memory:");
seedEndToEndStore(store);
const app = createApp(store);
const server = Bun.serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: 7351,
});

console.warn(
  `Scout review eval E2E server: http://127.0.0.1:${String(server.port)}`,
);

function shutdown(): void {
  store.close();
  void server.stop();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

import { createServer } from "vite";
import { EXPERIMENTS_API_PATH } from "./contract.ts";
import { createPublicExperimentApp } from "./app.ts";
import { createPostgresExperimentStore } from "./postgres.ts";
import { createMemoryExperimentStore } from "./store.ts";

const databaseUrl = Bun.env["DATABASE_URL"];
const isFixture = process.argv.includes("--fixture");
if (!isFixture && (databaseUrl === undefined || databaseUrl === "")) {
  throw new Error("Set DATABASE_URL for local storage or pass --fixture");
}
const store = isFixture
  ? createMemoryExperimentStore()
  : createPostgresExperimentStore(databaseUrl ?? "");
const host = "127.0.0.1";
const port = Number(Bun.env["EXPERIMENTS_DEV_PORT"] ?? "7409");
const browserOrigin = `http://${host}:${String(port)}`;
const app = createPublicExperimentApp({
  store,
  machineToken: Bun.env["EXPERIMENTS_MACHINE_TOKEN"] ?? crypto.randomUUID(),
  peerAddress: () => host,
  verifyOperator: (request) =>
    Promise.resolve(
      ["GET", "HEAD"].includes(request.method) ||
        request.headers.get("origin") === browserOrigin
        ? { login: "local-operator" }
        : { status: 403, error: "Same-origin dev request required" },
    ),
});
const apiServer = Bun.serve({ hostname: host, port: 0, fetch: app.fetch });
const vite = await createServer({
  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      [EXPERIMENTS_API_PATH]: `http://${host}:${String(apiServer.port)}`,
    },
  },
});
await vite.listen();
vite.printUrls();

async function shutdown() {
  await Promise.all([vite.close(), apiServer.stop()]);
  await store.close();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

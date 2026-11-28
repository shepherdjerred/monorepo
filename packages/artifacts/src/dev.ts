/**
 * Local development server: a real database, an in-memory object store (bytes
 * are lost on restart), no Flags service, and one operator login. Not an
 * entry point of the image.
 *
 *   DATABASE_URL=postgres://... bun run dev
 *
 * The two origins resolve to loopback (`*.localhost`), so
 * `curl -H 'Tailscale-User-Login: dev@localhost' http://artifacts.localhost:7440/agent/SKILL.md`
 * reaches the app host and `artifacts-content.localhost` the content host.
 */
import { createChangeHub } from "#infrastructure/change-hub.ts";
import { BootstrapSchema, behaviorConfig } from "#infrastructure/config.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { logEvent } from "#infrastructure/log.ts";
import { startServer } from "#server/server.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";

const port = Bun.env["PORT"] ?? "7440";
const config = BootstrapSchema.parse({
  S3_ENDPOINT: "http://127.0.0.1:1",
  AWS_ACCESS_KEY_ID: "dev",
  AWS_SECRET_ACCESS_KEY: "dev",
  ARTIFACTS_APP_ORIGIN: `http://artifacts.localhost:${port}`,
  ARTIFACTS_CONTENT_ORIGIN: `http://artifacts-content.localhost:${port}`,
  ENVIRONMENT: "development",
  FEATURE_FLAGS_MODE: "disabled",
  HOST: "127.0.0.1",
  PORT: port,
  ...Bun.env,
});
const settings = behaviorConfig("development", {
  flagsDisabled: true,
  environment: {
    ARTIFACTS_OPERATOR_LOGINS: "dev@localhost",
    ...Bun.env,
  },
});
const hub = createChangeHub(config.DATABASE_URL);
const { server } = await startServer({
  config,
  db: createDatabase(config.DATABASE_URL),
  store: memoryObjectStore(),
  settings,
  hub,
});
void hub.start();
logEvent("artifacts_dev_listening", { port: server.port ?? 0 });

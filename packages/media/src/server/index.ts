import { serveStatic } from "hono/bun";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { MediaAuth } from "#application/auth.ts";
import { CredentialCipher } from "#application/security.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import {
  BootstrapSchema,
  mediaBehaviorConfig,
} from "#infrastructure/config.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";
import { TmdbClient } from "#integrations/tmdb.ts";
import { createMediaApp } from "./app.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { DiscordOAuth } from "#infrastructure/discord-auth.ts";
import { createMediaWorkflowStarter } from "#automation/temporal-client.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { renderMediaMetrics } from "#infrastructure/metrics.ts";

const bootstrap = BootstrapSchema.parse(Bun.env);
await initFeatureFlags();
const behavior = mediaBehaviorConfig(bootstrap.ENVIRONMENT);
const database = createDatabase(bootstrap.DATABASE_URL);
await database.$connect();
const temporal = createMediaWorkflowStarter({
  address: bootstrap.TEMPORAL_ADDRESS,
  namespace: bootstrap.TEMPORAL_NAMESPACE,
});
const outbox = createOutboxActivities(database, temporal.start);
let dispatching: Promise<void> | null = null;
async function dispatchCommittedCommands(): Promise<void> {
  try {
    await outbox.dispatchMediaOutbox();
  } finally {
    dispatching = null;
  }
}
const sessionLifetime = await behavior.get("sessionLifetimeMs");
const keepDays = await behavior.get("keepDays");
const cipher = new CredentialCipher(bootstrap.MEDIA_CREDENTIAL_KEY);
const tmdbCredential =
  bootstrap.TMDB_API_KEY === undefined
    ? {
        kind: "bearer" as const,
        token:
          bootstrap.TMDB_TOKEN ??
          (() => {
            throw new Error("Missing TMDB credential");
          })(),
      }
    : { kind: "api-key" as const, apiKey: bootstrap.TMDB_API_KEY };
if (
  (bootstrap.DISCORD_CLIENT_ID === undefined) !==
  (bootstrap.DISCORD_CLIENT_SECRET === undefined)
)
  throw new Error("Both Discord OAuth credentials must be configured together");
const discord =
  bootstrap.DISCORD_CLIENT_ID !== undefined &&
  bootstrap.DISCORD_CLIENT_SECRET !== undefined
    ? new DiscordOAuth({
        clientId: bootstrap.DISCORD_CLIENT_ID,
        clientSecret: bootstrap.DISCORD_CLIENT_SECRET,
        redirectUri: new URL(
          "/notifications/discord",
          bootstrap.PUBLIC_ORIGIN,
        ).toString(),
      })
    : null;
const auth = new MediaAuth(
  new PrismaAuthStore(database),
  new PlexPinAuthentication({
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    applicationName: "Media",
    returnUrl: new URL("/", bootstrap.PUBLIC_ORIGIN).toString(),
  }),
  cipher,
  {
    ownerAccountId: bootstrap.PLEX_OWNER_ACCOUNT_ID,
    sessionLifetimeMs: sessionLifetime.value,
  },
);
const app = createMediaApp({
  auth,
  media: new PrismaMediaApplication(database, { keepDays: keepDays.value }),
  notifications: new PrismaNotificationApplication(database, cipher, discord),
  admin: new PrismaAdminApplication(database, cipher),
  catalog: new TmdbCatalogApplication(database, new TmdbClient(tmdbCredential)),
  publicOrigin: bootstrap.PUBLIC_ORIGIN,
  afterWrite: () => {
    dispatching ??= dispatchCommittedCommands();
    return dispatching;
  },
  requestsEnabled: async () => {
    const result = await behavior.get("requestsEnabled");
    return result.value;
  },
  onError: (error, requestId) => {
    console.error(
      JSON.stringify({
        event: "media_request_failed",
        requestId,
        category:
          error instanceof TypeError
            ? "type_contract"
            : error instanceof SyntaxError
              ? "serialized_contract"
              : "unexpected",
      }),
    );
  },
});
app.get("/assets/*", serveStatic({ root: "./dist" }));
app.get("/readyz", async (c) => {
  try {
    await database.$queryRaw`SELECT 1`;
    return c.json({ status: "ready" });
  } catch {
    return c.json({ status: "unavailable", dependency: "database" }, 503);
  }
});
app.get("/metrics", async (c) => {
  c.header("Content-Type", "text/plain; version=0.0.4");
  return c.body(await renderMediaMetrics(database));
});
app.get("*", async (c, next) => {
  return c.req.path === "/api" ||
    c.req.path.startsWith("/api/") ||
    c.req.path.startsWith("/assets/")
    ? next()
    : serveStatic({ path: "./dist/index.html" })(c, next);
});
const server = Bun.serve({
  hostname: bootstrap.HOST,
  port: bootstrap.PORT,
  fetch: app.fetch,
});
const stop = async () => {
  await server.stop();
  await temporal.close();
  await database.$disconnect();
  await shutdownFeatureFlags();
};
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});

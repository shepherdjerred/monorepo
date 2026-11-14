import { serveStatic } from "hono/bun";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { MediaAuth } from "#application/media-auth.ts";
import { CredentialCipher } from "#application/security.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { PrismaExternalLibraryRegistration } from "#infrastructure/external-library/registration/service.ts";
import { createExternalEditionCorrection } from "#infrastructure/external-library/edition/correction.ts";
import { PrismaExternalEditionStore } from "#infrastructure/external-library/edition/records.ts";
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
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { PrismaMediaHandoff } from "#infrastructure/handoff/service.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { PrismaMovieRollbackCommandsV1 } from "#infrastructure/movie-editions/rollback/manual/manual-command.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { PrismaMovieHistoryReviews } from "#infrastructure/movie-editions/history-review/service.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { MigrationCatalogDiscovery } from "#migration/catalog-discovery.ts";
import { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import { DiscordOAuth } from "#infrastructure/discord-auth.ts";
import { createMediaWorkflowStarter } from "#automation/temporal-client.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { renderMediaMetrics } from "#infrastructure/metrics.ts";
import { PrismaCapacityAdministration } from "#infrastructure/capacity/service.ts";
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { PrismaPlaybackHistory } from "#infrastructure/playback/service.ts";
import { playbackHandoffReady } from "#infrastructure/playback/handoff.ts";
import { PrismaCalendarApplication } from "#infrastructure/library/views/calendar.ts";
import { PrismaRemovalHistoryApplication } from "#infrastructure/library/views/removals.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { listRequestInterests } from "#infrastructure/request-interest/read.ts";

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
const permittedMovieSectionId = await behavior.get("permittedMovieSectionId");
const permittedTvSectionId = await behavior.get("permittedTvSectionId");
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
const plexAuthentication = new PlexPinAuthentication({
  serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
  serverUrl: bootstrap.PLEX_SERVER_URL,
  permittedMovieSectionId: permittedMovieSectionId.value,
  permittedTvSectionId: permittedTvSectionId.value,
  applicationName: "Media",
  returnUrl: new URL("/", bootstrap.PUBLIC_ORIGIN).toString(),
});
const auth = new MediaAuth(
  new PrismaAuthStore(database),
  plexAuthentication,
  cipher,
  {
    ownerAccountId: bootstrap.PLEX_OWNER_ACCOUNT_ID,
    sessionLifetimeMs: sessionLifetime.value,
  },
);
const tmdbClient = new TmdbClient(tmdbCredential);
const catalogApplication = new TmdbCatalogApplication(database, tmdbClient);
const plexAdministration = new PrismaPlexAdministration(
  database,
  cipher,
  plexAuthentication,
  {
    serverUrl: bootstrap.PLEX_SERVER_URL,
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
  },
);
async function movieAccess() {
  const section = await mediaBehaviorConfig(bootstrap.ENVIRONMENT, true).get(
    "permittedMovieSectionId",
  );
  return {
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    movieSectionId: section.value,
  };
}
const movieSubtitleReplacements = new PrismaMovieSubtitleReplacements(
  database,
  {
    keepDays: keepDays.value,
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    movieAccess,
  },
  temporal.describe,
);
const media = new PrismaMediaApplication(database, {
  keepDays: keepDays.value,
  serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
  movieAccess,
  plexAccess: async (sectionType) => {
    const section = await mediaBehaviorConfig(bootstrap.ENVIRONMENT, true).get(
      sectionType === "movie"
        ? "permittedMovieSectionId"
        : "permittedTvSectionId",
    );
    return {
      serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      sectionId: section.value,
      sectionType,
    };
  },
  visibilitySections: {
    movie: permittedMovieSectionId.value,
    series: permittedTvSectionId.value,
  },
});
const requestInterestCommands = new RequestInterestCommands(database, {
  keepDays: keepDays.value,
  serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
  movieAccess,
  sections: {
    movie: permittedMovieSectionId.value,
    series: permittedTvSectionId.value,
  },
});
const app = createMediaApp({
  auth,
  media,
  requestInterests: {
    list: (actor, cursor) => listRequestInterests(database, actor, cursor),
    execute: (actor, key, input) =>
      requestInterestCommands.execute(actor, key, input),
    libraryPolicy: (actor, key, input) =>
      requestInterestCommands.libraryPolicy(actor, key, input),
  },
  playback: new PrismaPlaybackHistory(
    database,
    bootstrap.PLEX_SERVER_MACHINE_ID,
    () => new Date(),
    playbackHandoffReady(database, (actor) =>
      plexAdministration.libraryClient(actor),
    ),
  ),
  library: new PrismaLibraryApplication(database, {
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    sections: {
      movie: permittedMovieSectionId.value,
      series: permittedTvSectionId.value,
    },
  }),
  calendar: new PrismaCalendarApplication(database, {
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    sections: {
      movie: permittedMovieSectionId.value,
      series: permittedTvSectionId.value,
    },
  }),
  removalHistory: new PrismaRemovalHistoryApplication(database, {
    serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    sections: {
      movie: permittedMovieSectionId.value,
      series: permittedTvSectionId.value,
    },
  }),
  movieLifecycle: media,
  notifications: new PrismaNotificationApplication(database, cipher, discord, {
    publicOrigin: bootstrap.PUBLIC_ORIGIN,
    movieAccess,
    plexAccess: async (sectionType) => {
      const section = await mediaBehaviorConfig(
        bootstrap.ENVIRONMENT,
        true,
      ).get(
        sectionType === "movie"
          ? "permittedMovieSectionId"
          : "permittedTvSectionId",
      );
      return {
        serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        sectionId: section.value,
        sectionType,
      };
    },
    discordEnabled: async () => {
      const flag = await mediaBehaviorConfig(bootstrap.ENVIRONMENT, true).get(
        "personalDiscordEnabled",
      );
      return flag.value;
    },
  }),
  admin: new PrismaAdminApplication(database, cipher),
  capacityAdmin: new PrismaCapacityAdministration(database, capacityEnabled),
  plexEvents: {
    ingress: new PrismaPlexEventIngress(database, {
      serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      permittedSections: async () => {
        const current = mediaBehaviorConfig(bootstrap.ENVIRONMENT, true);
        const movie = await current.get("permittedMovieSectionId");
        const series = await current.get("permittedTvSectionId");
        return {
          movie: movie.value,
          series: series.value,
        };
      },
    }),
    enabled: async () => {
      const result = await mediaBehaviorConfig(bootstrap.ENVIRONMENT, true).get(
        "plexEventHintsEnabled",
      );
      return result.value;
    },
    secret: bootstrap.PLEX_WEBHOOK_SECRET,
  },
  numberingAdmin: new PrismaNumberingAdministration(database, tmdbClient),
  handoffAdmin: new PrismaMediaHandoff(database),
  movieHistory: new PrismaMovieHistoryReviews(
    database,
    {
      keepDays: keepDays.value,
      serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      movieAccess,
    },
    {
      refreshManaged: (actor, userId) =>
        plexAdministration.refreshProfileAccess(actor, userId),
    },
  ),
  nativeRecoveryAdmin: new PrismaNativeRecovery(database, temporal.describe),
  subtitleReplacements: movieSubtitleReplacements.review,
  movieSubtitleReplacements,
  movieRollback: new PrismaMovieRollbackCommandsV1(
    database,
    {
      keepDays: keepDays.value,
      serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      movieAccess,
    },
    temporal.describe,
  ),
  recoveryAdmin: new PrismaRecovery(
    database,
    bootstrap.PLEX_SERVER_MACHINE_ID,
    (actor, userId) => plexAdministration.refreshProfileAccess(actor, userId),
  ),
  legacyRequesterBindings: new PrismaLegacyRequesterBindings(
    database,
    bootstrap.PLEX_SERVER_MACHINE_ID,
  ),
  migrationAdmin: new PrismaMigrationAdministration(
    database,
    new MigrationCatalogDiscovery(database, tmdbClient, catalogApplication),
  ),
  plexExclusionAdmin: new PrismaPlexExclusionAdministration(
    database,
    temporal.describe,
  ),
  plexAdmin: plexAdministration,
  externalLibrary: {
    registration: new PrismaExternalLibraryRegistration(database, {
      serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      ownerClient: (actor) => plexAdministration.libraryClient(actor),
      sections: async () => {
        const config = mediaBehaviorConfig(bootstrap.ENVIRONMENT, true);
        const [movie, series] = await Promise.all([
          config.get("permittedMovieSectionId"),
          config.get("permittedTvSectionId"),
        ]);
        return { movie: movie.value, series: series.value };
      },
    }),
    edition: async (actor) =>
      createExternalEditionCorrection({
        plex: await plexAdministration.libraryClient(actor),
        store: new PrismaExternalEditionStore(database),
        expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        permittedMovieSection: async () => {
          const section = await mediaBehaviorConfig(
            bootstrap.ENVIRONMENT,
            true,
          ).get("permittedMovieSectionId");
          return section.value;
        },
      }),
  },
  catalog: catalogApplication,
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
  return c.body(await renderMediaMetrics(database, await capacityEnabled()));
});
async function capacityEnabled() {
  const result = await mediaBehaviorConfig(bootstrap.ENVIRONMENT, true).get(
    "capacityObservationEnabled",
  );
  return result.value;
}
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

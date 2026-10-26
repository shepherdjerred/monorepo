import { MediaAuth, type PlexAuthentication } from "#application/auth.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { PrismaAdminApplication } from "#infrastructure/admin-service.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { PrismaCapacityAdministration } from "#infrastructure/capacity/service.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaMediaHandoff } from "#infrastructure/handoff/service.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaNativeRecovery } from "#infrastructure/native-recovery/service.ts";
import { PrismaNotificationApplication } from "#infrastructure/notification-service.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";
import { PrismaPlexAdministration } from "#infrastructure/plex-admin.ts";
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import { PrismaLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/service.ts";
import { PrismaRecovery } from "#infrastructure/recovery/service.ts";
import { PrismaSubtitleReplacements } from "#infrastructure/subtitle-replacement/service.ts";
import type { FetchTransport } from "#integrations/http.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import { MigrationCatalogDiscovery } from "#migration/catalog-discovery.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { createMediaApp } from "#server/app.ts";

/** Real HTTP, authentication, commands and outbox; only external services are supplied by the sandbox. */
export function createSystemHttpServer(input: {
  db: Database;
  cipher: CredentialCipher;
  plex: PlexAuthentication;
  plexTransport: FetchTransport;
  plexUrl: string;
  serverMachineId: string;
  ownerAccountId: string;
  tmdb: TmdbClient;
  startWorkflow: WorkflowStarter;
  describeWorkflow: MediaAutomationContext["describeWorkflow"];
}) {
  const { db, cipher, serverMachineId } = input;
  const errors: Error[] = [];
  const outbox = createOutboxActivities(db, input.startWorkflow);
  const catalog = new TmdbCatalogApplication(db, input.tmdb);
  const plexAdmin = new PrismaPlexAdministration(db, cipher, input.plex, {
    serverUrl: input.plexUrl,
    serverMachineId,
    transport: input.plexTransport,
  });
  const movieAccess = () =>
    Promise.resolve({ serverMachineId, movieSectionId: "1" });
  const plexAccess = (sectionType: "movie" | "show") =>
    Promise.resolve({
      serverMachineId,
      sectionType,
      sectionId: sectionType === "movie" ? "1" : "2",
    });
  // No request can run between these synchronous initializers. The listener's
  // allocated origin is also the app's real CSRF origin and cookie scope.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request): Response | Promise<Response> => app.fetch(request),
  });
  const origin = server.url.origin;
  const app = createMediaApp({
    auth: new MediaAuth(new PrismaAuthStore(db), input.plex, cipher, {
      ownerAccountId: input.ownerAccountId,
      sessionLifetimeMs: 3_600_000,
    }),
    media: new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId,
      movieAccess,
      plexAccess,
      visibilitySections: { movie: "1", series: "2" },
    }),
    catalog,
    admin: new PrismaAdminApplication(db, cipher),
    capacityAdmin: new PrismaCapacityAdministration(db, () =>
      Promise.resolve(false),
    ),
    notifications: new PrismaNotificationApplication(db, cipher, null, {
      publicOrigin: origin,
      movieAccess,
      plexAccess,
    }),
    plexAdmin,
    plexEvents: {
      secret: undefined,
      enabled: () => Promise.resolve(false),
      ingress: new PrismaPlexEventIngress(db, {
        serverMachineId,
        permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
      }),
    },
    numberingAdmin: new PrismaNumberingAdministration(db, input.tmdb),
    migrationAdmin: new PrismaMigrationAdministration(
      db,
      new MigrationCatalogDiscovery(db, input.tmdb, catalog),
    ),
    handoffAdmin: new PrismaMediaHandoff(db),
    nativeRecoveryAdmin: new PrismaNativeRecovery(db, input.describeWorkflow),
    subtitleReplacements: new PrismaSubtitleReplacements(
      db,
      input.describeWorkflow,
    ),
    recoveryAdmin: new PrismaRecovery(db, serverMachineId, (actor, userId) =>
      plexAdmin.refreshProfileAccess(actor, userId),
    ),
    legacyRequesterBindings: new PrismaLegacyRequesterBindings(
      db,
      serverMachineId,
    ),
    plexExclusionAdmin: new PrismaPlexExclusionAdministration(
      db,
      input.describeWorkflow,
    ),
    publicOrigin: origin,
    requestsEnabled: () => Promise.resolve(true),
    afterWrite: async () => {
      await outbox.dispatchMediaOutbox();
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  return {
    app,
    origin,
    outbox,
    errors,
    close: () => server.stop(true),
  };
}

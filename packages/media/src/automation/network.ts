import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { CredentialCipher } from "#application/security.ts";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { PlexClient } from "#integrations/plex.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { DatabaseProviderRegistry } from "./providers.ts";
import { createAcquisitionActivities } from "./acquisition.ts";
import { createPublicationActivities } from "./publication.ts";
import { createSeedingActivities } from "./seeding.ts";
import { createSweepActivities } from "./sweeps.ts";
import { createCoverageActivities } from "./reconciliation/coverage.ts";
import { createCatalogActivities } from "./reconciliation/catalog.ts";
import { TmdbClient } from "#integrations/tmdb.ts";
import { createOutboxActivities } from "./store.ts";
import type { MediaAutomationContext } from "./context.ts";
import { createMediaFileActivities } from "./files/activities.ts";
import { createRetentionActivities } from "./retention.ts";
import { createNotificationActivities } from "./notifications.ts";
import { createNotificationTransport } from "#integrations/notification-transport.ts";
import { createNotificationReceiptReader } from "#integrations/notifications/receipts.ts";
import { createMediaWorkflowStarter } from "./temporal-client.ts";
import { createSubtitleActivities } from "./subtitles.ts";
import { cleanupSubtitleBrowser } from "./subtitle-browser-lifecycle.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  requirePlexExclusionProof,
  refreshPlexExclusionProofs,
} from "./plex-exclusion/proof.ts";
import { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { createLegacyObserver } from "#integrations/legacy-observer/runtime.ts";
import { refreshWriterLease } from "#infrastructure/handoff/lease.ts";
import { refreshStorageAuthorities } from "#infrastructure/handoff/storage-observer.ts";
import { requireStorageAuthority } from "#infrastructure/handoff/storage.ts";
import { createHandoffNetworkProducer } from "#migration/handoff-network/producer.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";
import { createHandoffFileActivities } from "./handoff/activities.ts";
import { createNativeFileActivities } from "./native-recovery/activities.ts";
import { createSubtitleReplacementActivities } from "./subtitle-replacement/activities.ts";
import { createSubtitleReplacementNetworkActivities } from "#infrastructure/subtitle-replacement/activities.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";
import { createNativeQuarantineObserver } from "#migration/native-network/quarantine.ts";
import { createNativeQuarantineFileActivities } from "#automation/native-quarantine/activities.ts";
import type { FileContext } from "./files/types.ts";
import { createCapacityFileProducer } from "./capacity/files.ts";
import { createCapacityNetworkProducer } from "./capacity/network.ts";
import { createPlexEventActivities } from "./plex-events/activities.ts";

type LifecycleActivities = Pick<
  MediaNetworkActivities,
  "evaluateMediaRetention" | "deliverMediaNotification" | "findMediaSubtitles"
>;
export function createMediaNetworkActivities(
  context: MediaAutomationContext,
  lifecycle: LifecycleActivities,
): MediaNetworkActivities {
  const outbox = createOutboxActivities(context.db, context.startWorkflow);
  return {
    ...createAcquisitionActivities(context),
    ...createPublicationActivities(context),
    ...createSeedingActivities(context),
    ...createSweepActivities(context),
    ...createCoverageActivities(context),
    ...createCatalogActivities(context),
    ...outbox,
    async finishMediaOperation(input) {
      try {
        await cleanupSubtitleBrowser(
          context,
          input.operationId,
          input.reason ?? input.status,
        );
      } catch (error) {
        if (
          !(error instanceof IntegrationError) ||
          error.kind !== "outcome-unknown"
        )
          throw error;
        await outbox.finishMediaOperation({
          ...input,
          status: "reconciling",
          reason: "subtitle_browser_cleanup_requires_review",
        });
        return;
      }
      await outbox.finishMediaOperation(input);
    },
    ...lifecycle,
  };
}

const CommonBootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  ENVIRONMENT: z.string().default("production"),
});
const NetworkBootstrapSchema = CommonBootstrapSchema.extend({
  MEDIA_CREDENTIAL_KEY: z.string().min(1),
  PLEX_SERVER_URL: z.url(),
  PLEX_SERVER_TOKEN: z.string().min(1),
  PLEX_SERVER_MACHINE_ID: z.string().min(1),
  QBITTORRENT_URL: z.url(),
  QBITTORRENT_USERNAME: z.string().min(1),
  QBITTORRENT_PASSWORD: z.string().min(1),
  QBITTORRENT_DOWNLOAD_ROOT: z.literal("/downloads"),
  PUBLIC_ORIGIN: z.url(),
  TMDB_API_KEY: z.string().min(1).optional(),
  TMDB_TOKEN: z.string().min(1).optional(),
}).refine(
  (value) =>
    (value.TMDB_API_KEY === undefined) !== (value.TMDB_TOKEN === undefined),
  "Exactly one TMDB credential is required",
);
const FilesBootstrapSchema = CommonBootstrapSchema.extend({
  PLEX_SERVER_MACHINE_ID: z.string().min(1),
  MEDIA_FILE_WORKER_POD_UID: z.string().min(1),
  MEDIA_MOVIES_DOWNLOAD_ROOT: z.string().min(1),
  MEDIA_MOVIES_LIBRARY_ROOT: z.string().min(1),
  MEDIA_MOVIES_CONTROL_ROOT: z.string().min(1),
  MEDIA_TV_DOWNLOAD_ROOT: z.string().min(1),
  MEDIA_TV_LIBRARY_ROOT: z.string().min(1),
  MEDIA_TV_CONTROL_ROOT: z.string().min(1),
});

function createGates(stage: string) {
  const behavior = mediaBehaviorConfig(stage, true);
  const read = async (
    key:
      | "acquisitionEnabled"
      | "sourceCleanupEnabled"
      | "quarantineEnabled"
      | "purgeEnabled",
  ) => {
    const result = await behavior.get(key);
    return result.value;
  };
  return {
    acquisition: () => read("acquisitionEnabled"),
    sourceCleanup: () => read("sourceCleanupEnabled"),
    quarantine: () => read("quarantineEnabled"),
    purge: () => read("purgeEnabled"),
  };
}

export async function createMediaNetworkContext(
  environment: Record<string, string | undefined>,
  ports: Pick<
    MediaAutomationContext,
    | "startWorkflow"
    | "describeWorkflow"
    | "notify"
    | "reconcileNotification"
    | "sharedAnnouncements"
    | "personalDiscordAvailable"
    | "watchExecution"
  >,
): Promise<MediaAutomationContext> {
  const config = NetworkBootstrapSchema.parse(environment);
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const cipher = new CredentialCipher(config.MEDIA_CREDENTIAL_KEY);
  const behavior = mediaBehaviorConfig(config.ENVIRONMENT, true);
  const plexConfig = {
    baseUrl: config.PLEX_SERVER_URL,
    token: config.PLEX_SERVER_TOKEN,
    clientIdentifier: `media-${config.PLEX_SERVER_MACHINE_ID}`,
  };
  return {
    db,
    serverMachineId: config.PLEX_SERVER_MACHINE_ID,
    refreshWriterLease: async () => {
      const observer = createLegacyObserver(environment);
      await refreshWriterLease(db, () => observer.observe());
      await refreshStorageAuthorities(db, observer);
    },
    async refreshExclusionProofs() {
      const [movie, series] = await Promise.all([
        behavior.get("permittedMovieSectionId"),
        behavior.get("permittedTvSectionId"),
      ]);
      await refreshPlexExclusionProofs(
        db,
        new PlexMaintenanceClient(plexConfig),
        {
          machineId: config.PLEX_SERVER_MACHINE_ID,
          movieSectionId: movie.value,
          tvSectionId: series.value,
        },
      );
    },
    async permittedSections() {
      const [movie, series] = await Promise.all([
        behavior.get("permittedMovieSectionId"),
        behavior.get("permittedTvSectionId"),
      ]);
      return { movie: movie.value, series: series.value };
    },
    tmdb: new TmdbClient(
      config.TMDB_API_KEY === undefined
        ? { kind: "bearer", token: z.string().min(1).parse(config.TMDB_TOKEN) }
        : { kind: "api-key", apiKey: config.TMDB_API_KEY },
    ),
    cipher,
    providers: new DatabaseProviderRegistry(db, cipher),
    plex: new PlexClient(plexConfig),
    userPlex: (token) => new PlexClient({ ...plexConfig, token }),
    qbittorrent: new QbittorrentClient({
      baseUrl: config.QBITTORRENT_URL,
      username: config.QBITTORRENT_USERNAME,
      password: config.QBITTORRENT_PASSWORD,
      category: "media",
    }),
    downloadRoot: config.QBITTORRENT_DOWNLOAD_ROOT,
    gates: createGates(config.ENVIRONMENT),
    publicOrigin: config.PUBLIC_ORIGIN,
    ...ports,
  };
}

export async function createMediaFileRuntime(
  environment: Record<string, string | undefined>,
  checkpoint: (phase: string) => Promise<void>,
) {
  const config = FilesBootstrapSchema.parse(environment);
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const roots = {
    movies: {
      downloads: config.MEDIA_MOVIES_DOWNLOAD_ROOT,
      library: config.MEDIA_MOVIES_LIBRARY_ROOT,
      control: config.MEDIA_MOVIES_CONTROL_ROOT,
      controlPolicy: "plex-excluded" as const,
    },
    tv: {
      downloads: config.MEDIA_TV_DOWNLOAD_ROOT,
      library: config.MEDIA_TV_LIBRARY_ROOT,
      control: config.MEDIA_TV_CONTROL_ROOT,
      controlPolicy: "plex-excluded" as const,
    },
  };
  const fileContext: FileContext = {
    db,
    serverMachineId: config.PLEX_SERVER_MACHINE_ID,
    roots,
    checkpoint,
    verifyStorageAuthority: (root) =>
      requireStorageAuthority(
        db,
        root.library,
        config.MEDIA_FILE_WORKER_POD_UID,
      ),
    enabled: createGates(config.ENVIRONMENT),
    verifyPlexExclusion: (root) => requirePlexExclusionProof(db, root),
  };
  const activities = {
    ...createMediaFileActivities(fileContext),
    ...createSubtitleReplacementActivities(fileContext),
    ...createHandoffFileActivities({
      files: fileContext,
      workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
    }),
    ...createNativeFileActivities({
      files: fileContext,
      workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
    }),
    ...createNativeQuarantineFileActivities({
      files: fileContext,
      workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
    }),
  };
  const behavior = mediaBehaviorConfig(config.ENVIRONMENT, true);
  return {
    activities,
    capacity: {
      sampleMediaCapacity: createCapacityFileProducer({
        db,
        enabled: async () => {
          const flag = await behavior.get("capacityObservationEnabled");
          return flag.value;
        },
        roots: { movies: roots.movies.library, tv: roots.tv.library },
        workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
      }),
    },
    close: () => db.$disconnect(),
  };
}

const DeliveryBootstrapSchema = z
  .object({
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    POSTAL_HOST: z.url().optional(),
    POSTAL_API_KEY: z.string().min(1).optional(),
    POSTAL_HOST_HEADER: z.string().min(1).optional(),
    DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      (value.POSTAL_HOST === undefined) ===
      (value.POSTAL_API_KEY === undefined),
    { message: "Both Postal bootstrap credentials must be supplied together" },
  );

export async function createMediaNetworkRuntime(
  environment: Record<string, string | undefined>,
  watchExecution: MediaAutomationContext["watchExecution"],
) {
  const config = DeliveryBootstrapSchema.parse(environment);
  const temporal = createMediaWorkflowStarter({
    address: config.TEMPORAL_ADDRESS,
    namespace: config.TEMPORAL_NAMESPACE,
  });
  const behavior = mediaBehaviorConfig(
    CommonBootstrapSchema.parse(environment).ENVIRONMENT,
    true,
  );
  const deliveryConfig = async () => {
    const sender = await behavior.get("emailSender");
    return {
      ...(config.POSTAL_HOST === undefined ||
      config.POSTAL_API_KEY === undefined
        ? {}
        : {
            postal: {
              baseUrl: config.POSTAL_HOST,
              apiKey: config.POSTAL_API_KEY,
              from: sender.value,
              ...(config.POSTAL_HOST_HEADER === undefined
                ? {}
                : { hostHeader: config.POSTAL_HOST_HEADER }),
            },
          }),
      ...(config.DISCORD_BOT_TOKEN === undefined
        ? {}
        : { discord: { botToken: config.DISCORD_BOT_TOKEN } }),
    };
  };
  const context = await createMediaNetworkContext(environment, {
    watchExecution,
    startWorkflow: temporal.start,
    describeWorkflow: temporal.describe,
    personalDiscordAvailable: async () => {
      const flag = await behavior.get("personalDiscordEnabled");
      return config.DISCORD_BOT_TOKEN !== undefined && flag.value;
    },
    notify: async (message) =>
      createNotificationTransport(await deliveryConfig())(message),
    reconcileNotification: async (input) =>
      createNotificationReceiptReader(await deliveryConfig())(input),
    sharedAnnouncements: async () => {
      const [enabled, upgrades, channelId] = await Promise.all([
        behavior.get("sharedAnnouncementsEnabled"),
        behavior.get("sharedAnnouncementsUpgrades"),
        behavior.get("sharedDiscordChannelId"),
      ]);
      return {
        enabled: enabled.value,
        upgrades: upgrades.value,
        channelId: channelId.value,
        available: config.DISCORD_BOT_TOKEN !== undefined,
      };
    },
  });
  const lifecycle = {
    ...createRetentionActivities(context),
    ...createNotificationActivities(context),
    ...createSubtitleActivities(context),
  };
  const bootstrap = NetworkBootstrapSchema.parse(environment);
  const handoff = async (planId: string) => {
    const sections = await context.permittedSections();
    await context.qbittorrent.login();
    await createHandoffNetworkProducer({
      ...context,
      observer: createLegacyObserver(environment),
      expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
      authentication: new PlexPinAuthentication({
        serverMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        serverUrl: bootstrap.PLEX_SERVER_URL,
        permittedMovieSectionId: sections.movie,
        permittedTvSectionId: sections.series,
        applicationName: "Media",
        returnUrl: bootstrap.PUBLIC_ORIGIN,
      }),
    })(planId);
  };
  return {
    capacity: {
      observeMediaCapacityMounts: createCapacityNetworkProducer({
        db: context.db,
        enabled: async () => {
          const flag = await behavior.get("capacityObservationEnabled");
          return flag.value;
        },
        observeMounts: (signal) =>
          createLegacyObserver(environment).observeCanonicalMounts(signal),
      }),
    },
    activities: {
      ...createMediaNetworkActivities(context, lifecycle),
      ...createPlexEventActivities(context, async () => {
        const flag = await behavior.get("plexEventHintsEnabled");
        return flag.value;
      }),
      ...createSubtitleReplacementNetworkActivities(context.db),
      observeNativeRecovery: async (input: { planId: string }) => {
        await context.qbittorrent.login();
        await createNativeRecoveryObserver({
          ...context,
          observer: createLegacyObserver(environment),
          expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        })(input.planId);
      },
      observeNativeQuarantine: async (input: { planId: string }) => {
        await context.qbittorrent.login();
        await createNativeQuarantineObserver({
          ...context,
          observer: createLegacyObserver(environment),
          expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        })(input.planId);
      },
      nativeRecoveryState: async (input: { planId: string }) => {
        const plan = await context.db.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id: input.planId },
          include: { receipt: true },
        });
        return { state: plan.state, applied: plan.receipt !== null };
      },
      observeMediaHandoff: async (input: { planId: string }) =>
        handoff(input.planId),
      mediaHandoffState: async (input: { planId: string }) => {
        const plan = await context.db.mediaHandoffPlan.findUniqueOrThrow({
          where: { id: input.planId },
          include: { receipt: true },
        });
        return { state: plan.state, applied: plan.receipt !== null };
      },
    },
    close: async () => {
      await temporal.close();
      await context.db.$disconnect();
    },
  };
}

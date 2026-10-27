import {
  CommonBootstrapSchema,
  NetworkBootstrapSchema,
  FilesBootstrapSchema,
  DeliveryBootstrapSchema,
  createGates,
} from "./network/bootstrap.ts";
import {
  createPlexRuntimeFacets,
  createNativePlexFacet,
  createNativePlanObservers,
} from "./network/plex-facets.ts";
import { createNativeFileFacets } from "./network/native-files.ts";
import { capturePublicationExecution } from "./publication-proof/invocation.ts";
import { z } from "zod";
import { createDatabase } from "#infrastructure/database.ts";
import { CredentialCipher } from "#application/security.ts";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";
import { PlexClient } from "#integrations/plex.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type {
  PlexBindingActivities,
  PlexBindingExecution,
} from "#shared/plex-binding/activities.ts";
import { PlexAccessSchema } from "#shared/plex-binding/contract.ts";
import { DatabaseProviderRegistry } from "./providers.ts";
import { createAcquisitionActivities } from "./acquisition.ts";
import { createPublicationActivities } from "./publication.ts";
import { createSeedingActivities } from "./seeding.ts";
import { createSweepActivities } from "./sweeps.ts";
import { matchProviderFeedSourceV1 } from "./feeds/matching.ts";
import { createMovieNetworkFacetV4 } from "./movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "./files/movie-editions/activities.ts";
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
import { createHandoffNetworkActivities } from "./network/handoff.ts";
import { createHandoffFileActivities } from "./handoff/activities.ts";
import {
  createLibraryHandoffFileFacet,
  createLibraryHandoffNetworkFacet,
} from "./handoff/plex-edit-facets.ts";
import { createNativeFileActivities } from "./native-recovery/activities.ts";
import { createSubtitleReplacementActivities } from "./subtitle-replacement/activities.ts";
import { createSubtitleReplacementNetworkActivities } from "#infrastructure/subtitle-replacement/activities.ts";
import { createNativePlexObserver } from "#migration/native-plex/review.ts";
import { observePairedCompensationExecution } from "#migration/native-plex/compensation.ts";
import { observePairedArchiveCleanup } from "#migration/native-plex/archive.ts";
import { createNativeQuarantineFileActivities } from "#automation/native-quarantine/activities.ts";
import type { FileContext } from "./files/types.ts";
import { createCapacityFileProducer } from "./capacity/files.ts";
import { createCapacityNetworkProducer } from "./capacity/network.ts";
import { createPlexEventActivities } from "./plex-events/activities.ts";
import { createNativeArchiveFileActivities } from "./native-archive/activities.ts";
import type { NativeArchiveExecution } from "./native-archive/execution.ts";
import { createNativeArchiveNetworkActivities } from "#migration/native-archive/activities.ts";
import { createNativeCompensationNetworkActivities } from "#migration/native-compensation/activities.ts";
import { createNativeCompensationFileActivities } from "./native-compensation/activities.ts";
import type { NativeCompensationExecutionContext } from "#shared/native-recovery/compensation-runtime.ts";
import { createMediaPathMapping } from "#filesystem/media-paths.ts";
import {
  createAcquisitionNetworkFacet,
  createAcquisitionFileFacet,
} from "./acquisition-management/facets.ts";

type LifecycleActivities = Pick<
  MediaNetworkActivities,
  "evaluateMediaRetention" | "deliverMediaNotification" | "findMediaSubtitles"
>;
export function createMediaNetworkActivities(
  context: MediaAutomationContext,
  lifecycle: LifecycleActivities,
): Omit<
  MediaNetworkActivities,
  keyof PlexBindingActivities | "observeMediaUpgradeCleanup"
> {
  const outbox = createOutboxActivities(context.db, context.startWorkflow);
  return {
    ...createAcquisitionActivities(context),
    ...createPublicationActivities(context),
    ...createSeedingActivities(context),
    ...createSweepActivities(context),
    matchProviderFeedSource: (input) =>
      matchProviderFeedSourceV1(context, input),
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
    | "plexBindingExecution"
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
    async plexAccess(sectionType) {
      const configured = await behavior.get(
        sectionType === "movie"
          ? "permittedMovieSectionId"
          : "permittedTvSectionId",
      );
      return PlexAccessSchema.parse({
        serverMachineId: config.PLEX_SERVER_MACHINE_ID,
        sectionId: configured.value,
        sectionType,
      });
    },
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
  archiveExecution: () => NativeArchiveExecution,
  compensationExecution: () => NativeCompensationExecutionContext,
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
  const behavior = mediaBehaviorConfig(config.ENVIRONMENT, true);
  const fileContext: FileContext = {
    db,
    serverMachineId: config.PLEX_SERVER_MACHINE_ID,
    async plexAccess(sectionType) {
      const configured = await behavior.get(
        sectionType === "movie"
          ? "permittedMovieSectionId"
          : "permittedTvSectionId",
      );
      return PlexAccessSchema.parse({
        serverMachineId: config.PLEX_SERVER_MACHINE_ID,
        sectionId: configured.value,
        sectionType,
      });
    },
    permittedMovieSection: async () => {
      const configured = await behavior.get("permittedMovieSectionId");
      return configured.value;
    },
    roots,
    pathMapping: createMediaPathMapping({
      canonicalRoots: roots,
      workerRoots: roots,
    }),
    checkpoint,
    publicationExecution: () =>
      capturePublicationExecution(compensationExecution, "publication"),
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
    ...createNativeCompensationFileActivities(
      { files: fileContext, workerPodUid: config.MEDIA_FILE_WORKER_POD_UID },
      compensationExecution,
    ),
    ...createNativeArchiveFileActivities(
      { files: fileContext, workerPodUid: config.MEDIA_FILE_WORKER_POD_UID },
      archiveExecution,
    ),
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
  return {
    activities,
    acquisition: createAcquisitionFileFacet(fileContext),
    movie: createMovieFileFacetV4(fileContext),
    libraryHandoff: createLibraryHandoffFileFacet({
      files: fileContext,
      workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
    }),
    nativeFiles: createNativeFileFacets({
      files: fileContext,
      workerPodUid: config.MEDIA_FILE_WORKER_POD_UID,
    }),
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

export async function createMediaNetworkRuntime(
  environment: Record<string, string | undefined>,
  watchExecution: MediaAutomationContext["watchExecution"],
  archiveExecution: () => NativeArchiveExecution,
  executions: {
    compensation: () => NativeCompensationExecutionContext;
    plexBinding: () => PlexBindingExecution;
  },
) {
  const {
    compensation: compensationExecution,
    plexBinding: plexBindingExecution,
  } = executions;
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
    plexBindingExecution,
    startWorkflow: temporal.start,
    describeWorkflow: temporal.describe,
    personalDiscordAvailable: async () => {
      const flag = await behavior.get("personalDiscordEnabled");
      return config.DISCORD_BOT_TOKEN !== undefined && flag.value;
    },
    notify: async (message, mutation) => {
      const delivery = await deliveryConfig();
      mutation?.beforeMutation();
      return createNotificationTransport(delivery)(message, mutation);
    },
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
  const nativeContext = {
    ...context,
    observer: createLegacyObserver(environment),
    expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
  };
  const observeNative = createNativePlexObserver(nativeContext);
  const handoff = createHandoffNetworkActivities(context, {
    observer: nativeContext.observer,
    expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
    serverUrl: bootstrap.PLEX_SERVER_URL,
    publicOrigin: bootstrap.PUBLIC_ORIGIN,
  });
  return {
    libraryHandoff: createLibraryHandoffNetworkFacet(nativeContext),
    acquisition: createAcquisitionNetworkFacet(context),
    movie: createMovieNetworkFacetV4(context),
    nativePlex: createNativePlexFacet(nativeContext, observeNative),
    ...createPlexRuntimeFacets(context, async () => {
      const flag = await behavior.get("plexEventHintsEnabled");
      return flag.value;
    }),
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
      ...createNativeCompensationNetworkActivities(
        {
          ...context,
          observer: createLegacyObserver(environment),
          expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        },
        compensationExecution,
      ),
      ...createMediaNetworkActivities(context, lifecycle),
      ...createNativeArchiveNetworkActivities({
        ...context,
        observer: createLegacyObserver(environment),
        expectedServerMachineId: bootstrap.PLEX_SERVER_MACHINE_ID,
        archiveExecution,
      }),
      ...createPlexEventActivities(context, async () => {
        const flag = await behavior.get("plexEventHintsEnabled");
        return flag.value;
      }),
      ...createSubtitleReplacementNetworkActivities(context.db),
      ...createNativePlanObservers(observeNative, plexBindingExecution),
      observeNativeCompensationExecution: (
        input: Parameters<typeof observePairedCompensationExecution>[1],
      ) =>
        observePairedCompensationExecution(
          nativeContext,
          input,
          plexBindingExecution(),
        ),
      observeNativeArchiveCleanup: (
        input: Parameters<typeof observePairedArchiveCleanup>[1],
      ) =>
        observePairedArchiveCleanup(
          nativeContext,
          input,
          plexBindingExecution(),
        ),
      nativeRecoveryState: async (input: { planId: string }) => {
        const plan = await context.db.nativeRecoveryPlan.findUniqueOrThrow({
          where: { id: input.planId },
          include: { receipt: true },
        });
        return { state: plan.state, applied: plan.receipt !== null };
      },
      ...handoff,
    },
    close: async () => {
      await temporal.close();
      await context.db.$disconnect();
    },
  };
}

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
import { createOutboxActivities } from "./store.ts";
import type { MediaAutomationContext } from "./context.ts";
import { createMediaFileActivities } from "./files/activities.ts";
import { createRetentionActivities } from "./retention.ts";
import { createNotificationActivities } from "./notifications.ts";
import { createNotificationTransport } from "#integrations/notification-transport.ts";
import { createMediaWorkflowStarter } from "./temporal-client.ts";
import { createSubtitleActivities } from "./subtitles.ts";

type LifecycleActivities = Pick<
  MediaNetworkActivities,
  "evaluateMediaRetention" | "deliverMediaNotification" | "findMediaSubtitles"
>;
export function createMediaNetworkActivities(
  context: MediaAutomationContext,
  lifecycle: LifecycleActivities,
): MediaNetworkActivities {
  return {
    ...createAcquisitionActivities(context),
    ...createPublicationActivities(context),
    ...createSeedingActivities(context),
    ...createSweepActivities(context),
    ...createOutboxActivities(context.db, context.startWorkflow),
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
  QBITTORRENT_CATEGORY: z.string().min(1),
  QBITTORRENT_DOWNLOAD_ROOT: z.string().min(1),
  PUBLIC_ORIGIN: z.url(),
});
const FilesBootstrapSchema = CommonBootstrapSchema.extend({
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
  ports: Pick<MediaAutomationContext, "startWorkflow" | "notify">,
): Promise<MediaAutomationContext> {
  const config = NetworkBootstrapSchema.parse(environment);
  const db = createDatabase(config.DATABASE_URL);
  await db.$connect();
  const cipher = new CredentialCipher(config.MEDIA_CREDENTIAL_KEY);
  const plexConfig = {
    baseUrl: config.PLEX_SERVER_URL,
    token: config.PLEX_SERVER_TOKEN,
    clientIdentifier: `media-${config.PLEX_SERVER_MACHINE_ID}`,
  };
  return {
    db,
    cipher,
    providers: new DatabaseProviderRegistry(db, cipher),
    plex: new PlexClient(plexConfig),
    userPlex: (token) => new PlexClient({ ...plexConfig, token }),
    qbittorrent: new QbittorrentClient({
      baseUrl: config.QBITTORRENT_URL,
      username: config.QBITTORRENT_USERNAME,
      password: config.QBITTORRENT_PASSWORD,
      category: config.QBITTORRENT_CATEGORY,
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
  const activities = createMediaFileActivities({
    db,
    roots,
    checkpoint,
    enabled: createGates(config.ENVIRONMENT),
    verifyPlexExclusion: async (root) => {
      const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const proof = await db.applicationEvent.findFirst({
        where: {
          kind: "plex_control_exclusion_verified",
          payload: { path: ["libraryRoot"], equals: root.library },
        },
        orderBy: { createdAt: "desc" },
      });
      const evidence = z
        .object({
          controlRoot: z.string(),
          recoveryEpoch: z.number().int(),
          scannerExcluded: z.literal(true),
        })
        .safeParse(proof?.payload);
      if (
        !evidence.success ||
        evidence.data.controlRoot !== root.control ||
        evidence.data.recoveryEpoch !== runtime.recoveryEpoch
      )
        throw new Error(
          "Plex control-directory exclusion has not been verified for this recovery epoch",
        );
    },
  });
  return { activities, close: () => db.$disconnect() };
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
  const notify: MediaAutomationContext["notify"] = async (message) => {
    const sender = await behavior.get("emailSender");
    return createNotificationTransport({
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
    })(message);
  };
  const context = await createMediaNetworkContext(environment, {
    startWorkflow: temporal.start,
    notify,
  });
  const lifecycle = {
    ...createRetentionActivities(context),
    ...createNotificationActivities(context),
    ...createSubtitleActivities(context),
  };
  return {
    activities: createMediaNetworkActivities(context, lifecycle),
    close: async () => {
      await temporal.close();
      await context.db.$disconnect();
    },
  };
}

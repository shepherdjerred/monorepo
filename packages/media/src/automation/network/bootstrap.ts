import { z } from "zod";
import { mediaBehaviorConfig } from "#infrastructure/config.ts";

export const CommonBootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  ENVIRONMENT: z.string().default("production"),
});
export const NetworkBootstrapSchema = CommonBootstrapSchema.extend({
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
export const FilesBootstrapSchema = CommonBootstrapSchema.extend({
  PLEX_SERVER_MACHINE_ID: z.string().min(1),
  MEDIA_FILE_WORKER_POD_UID: z.string().min(1),
  MEDIA_MOVIES_DOWNLOAD_ROOT: z.string().min(1),
  MEDIA_MOVIES_LIBRARY_ROOT: z.string().min(1),
  MEDIA_MOVIES_CONTROL_ROOT: z.string().min(1),
  MEDIA_TV_DOWNLOAD_ROOT: z.string().min(1),
  MEDIA_TV_LIBRARY_ROOT: z.string().min(1),
  MEDIA_TV_CONTROL_ROOT: z.string().min(1),
});

export function createGates(stage: string) {
  const behavior = mediaBehaviorConfig(stage, true);
  const read = async (
    key:
      | "acquisitionEnabled"
      | "subtitleMaintenanceEnabled"
      | "sourceCleanupEnabled"
      | "quarantineEnabled"
      | "purgeEnabled",
  ) => {
    const result = await behavior.get(key);
    return result.value;
  };
  return {
    acquisition: () => read("acquisitionEnabled"),
    subtitleMaintenance: () => read("subtitleMaintenanceEnabled"),
    sourceCleanup: () => read("sourceCleanupEnabled"),
    quarantine: () => read("quarantineEnabled"),
    purge: () => read("purgeEnabled"),
  };
}

export const DeliveryBootstrapSchema = z
  .object({
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    MAIL_API_URL: z.url().optional(),
    MAIL_API_TOKEN: z.string().min(1).optional(),
    DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      (value.MAIL_API_URL === undefined) ===
      (value.MAIL_API_TOKEN === undefined),
    { error: "Both Mail bootstrap credentials must be supplied together" },
  );

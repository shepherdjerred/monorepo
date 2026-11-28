import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { z } from "zod";

export const BootstrapSchema = z
  .object({
    DATABASE_URL: z.url(),
    MEDIA_CREDENTIAL_KEY: z.string().min(1),
    PLEX_SERVER_MACHINE_ID: z.string().min(1),
    PLEX_SERVER_URL: z.url(),
    PLEX_OWNER_ACCOUNT_ID: z.string().min(1),
    PLEX_WEBHOOK_SECRET: z.string().min(32).max(256).optional(),
    TMDB_TOKEN: z.string().min(1).optional(),
    TMDB_API_KEY: z.string().min(1).optional(),
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    PUBLIC_ORIGIN: z.url(),
    /**
     * Where the artwork cache keeps its files: deployment wiring, not
     * behavior. The default is inside the pod's writable `/tmp`; a deployment
     * that mounts a volume for the cache points this at the mount instead.
     */
    MEDIA_ARTWORK_CACHE_DIR: z
      .string()
      .startsWith("/")
      .default("/tmp/media-artwork"),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7357),
    ENVIRONMENT: z
      .enum(["production", "beta", "development", "test"])
      .default("production"),
  })
  .refine(
    (value) =>
      (value.TMDB_TOKEN === undefined) !== (value.TMDB_API_KEY === undefined),
    { error: "Exactly one TMDB credential is required" },
  );

export function mediaBehaviorConfig(
  stage: string,
  requireFreshSnapshot = false,
) {
  return defineConfig({
    definition: {
      personalDiscordEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-personal-discord-enabled" },
      },
      sharedAnnouncementsEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-shared-announcements-enabled" },
      },
      sharedAnnouncementsUpgrades: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-shared-announcements-upgrades" },
      },
      sharedDiscordChannelId: {
        schema: flagValueSchema("media-shared-discord-channel-id").transform(
          (value) => (value === "disabled" ? "" : value),
        ),
        sources: ["flag", "default"],
        default: "disabled",
        names: { flag: "media-shared-discord-channel-id" },
      },
      requestsEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "media-requests-enabled" },
      },
      acquisitionEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "media-acquisition-enabled" },
      },
      subtitleMaintenanceEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: true,
        names: { flag: "media-subtitle-maintenance-enabled" },
      },
      capacityObservationEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-capacity-observation-enabled" },
      },
      plexEventHintsEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-plex-event-hints-enabled" },
      },
      sourceCleanupEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-source-cleanup-enabled" },
      },
      quarantineEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-quarantine-enabled" },
      },
      purgeEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-purge-enabled" },
      },
      sessionLifetimeMs: {
        schema: flagValueSchema("media-session-lifetime-ms"),
        sources: ["flag", "default"],
        default: 7 * 86_400_000,
        names: { flag: "media-session-lifetime-ms" },
      },
      keepDays: {
        schema: flagValueSchema("media-keep-days"),
        sources: ["flag", "default"],
        default: 30,
        names: { flag: "media-keep-days" },
      },
      emailSender: {
        schema: flagValueSchema("media-email-sender"),
        sources: ["flag", "default"],
        default: "media@sjer.red",
        names: { flag: "media-email-sender" },
      },
      permittedMovieSectionId: {
        schema: flagValueSchema("media-permitted-movie-section-id"),
        sources: ["flag", "default"],
        default: "1",
        names: { flag: "media-permitted-movie-section-id" },
      },
      permittedTvSectionId: {
        schema: flagValueSchema("media-permitted-tv-section-id"),
        sources: ["flag", "default"],
        default: "2",
        names: { flag: "media-permitted-tv-section-id" },
      },
      artworkCacheMaxBytes: {
        schema: flagValueSchema("media-artwork-cache-max-bytes"),
        sources: ["flag", "default"],
        default: 1024 * 1024 * 1024,
        names: { flag: "media-artwork-cache-max-bytes" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        requireFreshSnapshot,
        targetingKey: "media",
        attributes: { stage },
        kinds: {
          personalDiscordEnabled: "boolean",
          sharedAnnouncementsEnabled: "boolean",
          sharedAnnouncementsUpgrades: "boolean",
          sharedDiscordChannelId: flagValueKind(
            "media-shared-discord-channel-id",
          ),
          requestsEnabled: "boolean",
          acquisitionEnabled: "boolean",
          subtitleMaintenanceEnabled: "boolean",
          capacityObservationEnabled: "boolean",
          plexEventHintsEnabled: "boolean",
          sourceCleanupEnabled: "boolean",
          quarantineEnabled: "boolean",
          purgeEnabled: "boolean",
          sessionLifetimeMs: flagValueKind("media-session-lifetime-ms"),
          keepDays: flagValueKind("media-keep-days"),
          emailSender: flagValueKind("media-email-sender"),
          permittedMovieSectionId: flagValueKind(
            "media-permitted-movie-section-id",
          ),
          permittedTvSectionId: flagValueKind("media-permitted-tv-section-id"),
          artworkCacheMaxBytes: flagValueKind("media-artwork-cache-max-bytes"),
        },
      }),
    },
  });
}

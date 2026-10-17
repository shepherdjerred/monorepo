import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export const BootstrapSchema = z
  .object({
    DATABASE_URL: z.url(),
    MEDIA_CREDENTIAL_KEY: z.string().min(1),
    PLEX_SERVER_MACHINE_ID: z.string().min(1),
    PLEX_SERVER_URL: z.url(),
    PLEX_OWNER_ACCOUNT_ID: z.string().min(1),
    TMDB_TOKEN: z.string().min(1).optional(),
    TMDB_API_KEY: z.string().min(1).optional(),
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    PUBLIC_ORIGIN: z.url(),
    TEMPORAL_ADDRESS: z.string().min(1),
    TEMPORAL_NAMESPACE: z.string().min(1),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(7352),
    ENVIRONMENT: z
      .enum(["production", "beta", "development", "test"])
      .default("production"),
  })
  .refine(
    (value) =>
      (value.TMDB_TOKEN === undefined) !== (value.TMDB_API_KEY === undefined),
    { message: "Exactly one TMDB credential is required" },
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
        schema: z
          .union([z.literal("disabled"), z.string().regex(/^\d{1,25}$/u)])
          .transform((value) => (value === "disabled" ? "" : value)),
        sources: ["flag", "default"],
        default: "disabled",
        names: { flag: "media-shared-discord-channel-id" },
      },
      requestsEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-requests-enabled" },
      },
      acquisitionEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-acquisition-enabled" },
      },
      capacityObservationEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: false,
        names: { flag: "media-capacity-observation-enabled" },
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
        schema: z.coerce
          .number()
          .int()
          .min(60_000)
          .max(7 * 86_400_000),
        sources: ["flag", "default"],
        default: 7 * 86_400_000,
        names: { flag: "media-session-lifetime-ms" },
      },
      keepDays: {
        schema: z.coerce.number().int().min(1).max(365),
        sources: ["flag", "default"],
        default: 30,
        names: { flag: "media-keep-days" },
      },
      emailSender: {
        schema: z.email(),
        sources: ["flag", "default"],
        default: "media@sjer.red",
        names: { flag: "media-email-sender" },
      },
      permittedMovieSectionId: {
        schema: z.string().regex(/^[1-9]\d*$/u),
        sources: ["flag", "default"],
        default: "1",
        names: { flag: "media-permitted-movie-section-id" },
      },
      permittedTvSectionId: {
        schema: z.string().regex(/^[1-9]\d*$/u),
        sources: ["flag", "default"],
        default: "2",
        names: { flag: "media-permitted-tv-section-id" },
      },
    },
    sources: {
      flag: createFlagConfigSource({
        requireFreshSnapshot,
        targetingKey: "media",
        attributes: { stage },
        kinds: {
          sharedAnnouncementsEnabled: "boolean",
          sharedAnnouncementsUpgrades: "boolean",
          sharedDiscordChannelId: "string",
          requestsEnabled: "boolean",
          acquisitionEnabled: "boolean",
          capacityObservationEnabled: "boolean",
          sourceCleanupEnabled: "boolean",
          quarantineEnabled: "boolean",
          purgeEnabled: "boolean",
          sessionLifetimeMs: "string",
          keepDays: "string",
          emailSender: "string",
          permittedMovieSectionId: "string",
          permittedTvSectionId: "string",
        },
      }),
    },
  });
}

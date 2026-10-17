import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { z } from "zod";

export const BootstrapSchema = z
  .object({
    DATABASE_URL: z.url(),
    MEDIA_CREDENTIAL_KEY: z.string().min(1),
    PLEX_SERVER_MACHINE_ID: z.string().min(1),
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
    },
    sources: {
      flag: createFlagConfigSource({
        requireFreshSnapshot,
        targetingKey: "media",
        attributes: { stage },
        kinds: {
          requestsEnabled: "boolean",
          acquisitionEnabled: "boolean",
          sourceCleanupEnabled: "boolean",
          quarantineEnabled: "boolean",
          purgeEnabled: "boolean",
          sessionLifetimeMs: "string",
          keepDays: "string",
          emailSender: "string",
        },
      }),
    },
  });
}

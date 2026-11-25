import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { FeatureFlagModeSchema } from "@shepherdjerred/feature-flags/config/schema.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod";
import {
  DEFAULT_PUBLIC_INGEST_HOST,
  DEFAULT_TAILNET_CONSOLE_URL,
  DEFAULT_TRACKER_BASE_URL,
} from "#shared/contract.ts";

function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export const BootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(7370),
  ERRORS_INGEST_PORT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(0).max(65_535).optional(),
  ),
  PUBLIC_INGEST_ORIGIN: z.url().default(DEFAULT_PUBLIC_INGEST_HOST),
  CONSOLE_PUBLIC_ORIGIN: z.url().default(DEFAULT_TAILNET_CONSOLE_URL),
  ERRORS_MACHINE_TOKEN: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).optional(),
  ),
  TRACKER_API_URL: z
    .url()
    .default("http://tracker.tracker.svc.cluster.local:7351"),
  TRACKER_PUBLIC_URL: z.url().default(DEFAULT_TRACKER_BASE_URL),
  MAIL_API_URL: z.preprocess(emptyStringToUndefined, z.url().optional()),
  MAIL_API_TOKEN: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).optional(),
  ),
  MAIL_FROM: z.string().min(3).default("Errors <errors@sjer.red>"),
  MAIL_TO: z.email().default("alerts@sjer.red"),
  BUGSINK_IMPORT_URL: z.preprocess(emptyStringToUndefined, z.url().optional()),
  BUGSINK_IMPORT_TOKEN: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).optional(),
  ),
  FEATURE_FLAGS_MODE: z.preprocess(
    emptyStringToUndefined,
    FeatureFlagModeSchema.optional(),
  ),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    emptyStringToUndefined,
    z.url().optional(),
  ),
  ENVIRONMENT: z
    .enum(["production", "beta", "development", "test"])
    .default("production"),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

export function behaviorConfig(stage: string, disabled = false) {
  const flagEnvironment =
    stage === "production" || stage === "prod" ? "prod" : "beta";

  return defineConfig({
    definition: {
      ingestEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "errors-ingest-enabled",
          flagEnvironment,
        ),
        names: { flag: "errors-ingest-enabled" },
      },
      emailNotificationsEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "errors-email-notifications-enabled",
          flagEnvironment,
        ),
        names: { flag: "errors-email-notifications-enabled" },
      },
      trackerCreationEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "errors-tracker-creation-enabled",
          flagEnvironment,
        ),
        names: { flag: "errors-tracker-creation-enabled" },
      },
      telemetryEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "errors-telemetry-enabled",
          flagEnvironment,
        ),
        names: { flag: "errors-telemetry-enabled" },
      },
    },
    sources: disabled
      ? {}
      : {
          flag: createFlagConfigSource({
            targetingKey: "errors",
            attributes: { stage },
            kinds: {
              ingestEnabled: "boolean",
              emailNotificationsEnabled: "boolean",
              trackerCreationEnabled: "boolean",
              telemetryEnabled: "boolean",
            },
          }),
        },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            message: "errors_config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}

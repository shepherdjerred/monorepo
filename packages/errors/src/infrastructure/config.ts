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

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);
const optionalHttpUrl = z.preprocess(emptyToUndefined, z.url().optional());
const tcpPortNumber = z.coerce.number().int().min(0).max(65_535);

export const BootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: tcpPortNumber.default(7370),
  ERRORS_INGEST_PORT: z.preprocess(emptyToUndefined, tcpPortNumber.optional()),
  PUBLIC_INGEST_ORIGIN: z.url().default(DEFAULT_PUBLIC_INGEST_HOST),
  CONSOLE_PUBLIC_ORIGIN: z.url().default(DEFAULT_TAILNET_CONSOLE_URL),
  ERRORS_MACHINE_TOKEN: optionalNonEmptyString,
  TRACKER_API_URL: z
    .url()
    .default("http://tracker.tracker.svc.cluster.local:7351"),
  TRACKER_PUBLIC_URL: z.url().default(DEFAULT_TRACKER_BASE_URL),
  MAIL_API_URL: optionalHttpUrl,
  MAIL_API_TOKEN: optionalNonEmptyString,
  MAIL_FROM: z.string().min(3).default("Errors <errors@sjer.red>"),
  MAIL_TO: z.email().default("alerts@sjer.red"),
  BUGSINK_IMPORT_URL: optionalHttpUrl,
  BUGSINK_IMPORT_TOKEN: optionalNonEmptyString,
  FEATURE_FLAGS_MODE: z.preprocess(
    emptyToUndefined,
    FeatureFlagModeSchema.optional(),
  ),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalHttpUrl,
  ENVIRONMENT: z
    .enum(["production", "beta", "development", "test"])
    .default("production"),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

type BooleanFlagKey = Parameters<typeof managedBooleanDefault>[0];

function booleanFlagDefinition(
  flagKey: BooleanFlagKey,
  environment: "prod" | "beta",
) {
  return {
    schema: z.boolean(),
    sources: ["flag", "default"] as const,
    default: managedBooleanDefault(flagKey, environment),
    names: { flag: flagKey },
  };
}

export function behaviorConfig(stage: string, disabled = false) {
  const flagEnv = stage === "production" || stage === "prod" ? "prod" : "beta";

  return defineConfig({
    definition: {
      ingestEnabled: booleanFlagDefinition("errors-ingest-enabled", flagEnv),
      emailNotificationsEnabled: booleanFlagDefinition(
        "errors-email-notifications-enabled",
        flagEnv,
      ),
      trackerCreationEnabled: booleanFlagDefinition(
        "errors-tracker-creation-enabled",
        flagEnv,
      ),
      telemetryEnabled: booleanFlagDefinition(
        "errors-telemetry-enabled",
        flagEnv,
      ),
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

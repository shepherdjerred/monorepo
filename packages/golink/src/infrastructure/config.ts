import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod";
import { UpsertManualLinkInputSchema } from "#shared/contract.ts";

function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export const SeedEntrySchema = z.object({
  short: UpsertManualLinkInputSchema.shape.short,
  targetUrl: UpsertManualLinkInputSchema.shape.targetUrl,
  createdBy: z.string().default("seed"),
});
export type SeedEntry = z.infer<typeof SeedEntrySchema>;

const SeedEntryListSchema = z.array(SeedEntrySchema);

export const BootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(7352),
  TAILNET_DOMAIN: z.string().min(1).default("tailnet-1a49.ts.net"),
  GOLINK_PLATFORM_MODEL_PATH: z.preprocess(
    emptyStringToUndefined,
    z.string().min(1).optional(),
  ),
  GOLINK_SEED_JSON: z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .transform((value, context) => {
        try {
          const parsed: unknown = JSON.parse(value);
          return SeedEntryListSchema.parse(parsed);
        } catch {
          context.addIssue({
            code: "custom",
            message:
              "GOLINK_SEED_JSON must be a valid JSON array of { short, targetUrl, createdBy? }",
          });
          return z.NEVER;
        }
      })
      .optional(),
  ),
  FEATURE_FLAGS_MODE: z.preprocess(
    emptyStringToUndefined,
    z.enum(["flipt", "static", "disabled"]).optional(),
  ),
  BUGSINK_DSN: z.preprocess(emptyStringToUndefined, z.url().optional()),
  VERSION: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
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
      dynamicAliasesEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "golink-dynamic-aliases-enabled",
          flagEnvironment,
        ),
        names: { flag: "golink-dynamic-aliases-enabled" },
      },
      writesEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "golink-writes-enabled",
          flagEnvironment,
        ),
        names: { flag: "golink-writes-enabled" },
      },
      telemetryEnabled: {
        schema: z.boolean(),
        sources: ["flag", "default"],
        default: managedBooleanDefault(
          "golink-telemetry-enabled",
          flagEnvironment,
        ),
        names: { flag: "golink-telemetry-enabled" },
      },
    },
    sources: disabled
      ? {}
      : {
          flag: createFlagConfigSource({
            targetingKey: "golink",
            attributes: { stage },
            kinds: {
              dynamicAliasesEnabled: "boolean",
              writesEnabled: "boolean",
              telemetryEnabled: "boolean",
            },
          }),
        },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            message: "golink_config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}

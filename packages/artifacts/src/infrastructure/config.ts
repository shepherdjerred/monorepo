import { defineConfig } from "@shepherdjerred/config";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { FeatureFlagModeSchema } from "@shepherdjerred/feature-flags/config/schema.ts";
import { z } from "zod";
import { LIMIT_DEFAULTS } from "#shared/contract.ts";

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const OriginSchema = z
  .url()
  .refine((value) => new URL(value).origin === value, {
    message: "must be an origin: scheme, host and optional port, no path",
  });

/**
 * Bootstrap: credentials, listeners and the two origins. Product limits are
 * typed configuration below.
 */
export const BootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(7440),
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1).default("artifacts-blobs"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  /** `https://artifacts.tailnet-1a49.ts.net`: the UI, `/trpc`, `/api`, `/agent`. */
  ARTIFACTS_APP_ORIGIN: OriginSchema,
  /** `https://artifacts-content.tailnet-1a49.ts.net`: sandboxed content. */
  ARTIFACTS_CONTENT_ORIGIN: OriginSchema,
  FEATURE_FLAGS_MODE: z.preprocess(
    emptyToUndefined,
    FeatureFlagModeSchema.optional(),
  ),
  ENVIRONMENT: z
    .enum(["production", "beta", "development", "test"])
    .default("production"),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

const positiveInt = (max: number) =>
  z.coerce.number().int().positive().max(max);

const FLAG_KINDS = {
  artifactsEnabled: "boolean",
  maxFileBytes: "string",
  maxVersionBytes: "string",
  maxFiles: "string",
  feedbackSettleSeconds: "string",
  deliveryOrphanMinutes: "string",
  boardIdleDays: "string",
  archiveGraceDays: "string",
  uploadTtlHours: "string",
  blobGraceHours: "string",
  eventRetentionDays: "string",
} as const;

const GIB = 1024 * 1024 * 1024;

export type BehaviorOptions = {
  /** `FEATURE_FLAGS_MODE=disabled`: no flag layer, defaults apply. */
  flagsDisabled?: boolean;
  /** The environment the `operatorLogins` bootstrap key reads. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Replaces the flag layer, for tests that need small limits. */
  flagValues?: Readonly<Record<string, unknown>>;
};

/**
 * Typed behavior configuration. `operatorLogins` is bootstrap (env only);
 * everything else resolves `flag -> default`. The `artifacts-enabled` flag
 * pauses writes; its managed-inventory entry is added with the activation.
 */
export function behaviorConfig(stage: string, options: BehaviorOptions = {}) {
  const flag = <S extends z.ZodType>(
    key: string,
    defaultValue: unknown,
    schema: S,
  ) => ({
    schema,
    sources: ["flag", "default"] as const,
    default: defaultValue,
    names: { flag: key },
  });
  const flagSource =
    options.flagValues === undefined
      ? options.flagsDisabled === true
        ? undefined
        : createFlagConfigSource({
            targetingKey: "artifacts",
            attributes: { stage },
            kinds: FLAG_KINDS,
          })
      : {
          name: "flag" as const,
          get: (names: { flag: string }) => {
            const value = options.flagValues?.[names.flag];
            return Promise.resolve(value === undefined ? undefined : { value });
          },
        };
  return defineConfig({
    definition: {
      operatorLogins: {
        schema: z.string().transform((value) =>
          value
            .split(",")
            .map((login) => login.trim())
            .filter((login) => login.length > 0),
        ),
        sources: ["env"],
        default: "",
        names: { env: "ARTIFACTS_OPERATOR_LOGINS" },
      },
      artifactsEnabled: flag("artifacts-enabled", true, z.boolean()),
      maxFileBytes: flag(
        "artifacts-max-file-bytes",
        LIMIT_DEFAULTS.maxFileBytes,
        positiveInt(4 * GIB),
      ),
      maxVersionBytes: flag(
        "artifacts-max-version-bytes",
        LIMIT_DEFAULTS.maxVersionBytes,
        positiveInt(16 * GIB),
      ),
      maxFiles: flag(
        "artifacts-max-files",
        LIMIT_DEFAULTS.maxFiles,
        positiveInt(10_000),
      ),
      feedbackSettleSeconds: flag(
        "artifacts-feedback-settle-seconds",
        LIMIT_DEFAULTS.feedbackSettleSeconds,
        z.coerce.number().min(0).max(600),
      ),
      deliveryOrphanMinutes: flag(
        "artifacts-delivery-orphan-minutes",
        LIMIT_DEFAULTS.deliveryOrphanMinutes,
        positiveInt(10_080),
      ),
      boardIdleDays: flag(
        "artifacts-board-idle-days",
        LIMIT_DEFAULTS.boardIdleDays,
        positiveInt(3650),
      ),
      archiveGraceDays: flag(
        "artifacts-archive-grace-days",
        LIMIT_DEFAULTS.archiveGraceDays,
        z.coerce.number().int().min(0).max(3650),
      ),
      uploadTtlHours: flag("artifacts-upload-ttl-hours", 24, positiveInt(720)),
      blobGraceHours: flag("artifacts-blob-grace-hours", 24, positiveInt(720)),
      eventRetentionDays: flag(
        "artifacts-event-retention-days",
        30,
        positiveInt(3650),
      ),
    },
    sources: {
      env: createEnvSource(options.environment ?? Bun.env),
      ...(flagSource === undefined ? {} : { flag: flagSource }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(
          JSON.stringify({
            message: "config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}
export type Settings = ReturnType<typeof behaviorConfig>;

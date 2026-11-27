import { defineConfig } from "@shepherdjerred/config";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
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

/**
 * The numeric limits. Each key's bounds live in the feature-flags variant
 * registry, so the Flags server rejects an out-of-range write and this config
 * reads the same schema.
 */
const NUMERIC_FLAGS = {
  maxFileBytes: "artifacts-max-file-bytes",
  maxVersionBytes: "artifacts-max-version-bytes",
  maxFiles: "artifacts-max-files",
  feedbackSettleSeconds: "artifacts-feedback-settle-seconds",
  deliveryOrphanMinutes: "artifacts-delivery-orphan-minutes",
  boardIdleDays: "artifacts-board-idle-days",
  archiveGraceDays: "artifacts-archive-grace-days",
  uploadTtlHours: "artifacts-upload-ttl-hours",
  blobGraceHours: "artifacts-blob-grace-hours",
  eventRetentionDays: "artifacts-event-retention-days",
} as const;

const FLAG_KINDS = {
  artifactsEnabled: "boolean",
  maxFileBytes: flagValueKind(NUMERIC_FLAGS.maxFileBytes),
  maxVersionBytes: flagValueKind(NUMERIC_FLAGS.maxVersionBytes),
  maxFiles: flagValueKind(NUMERIC_FLAGS.maxFiles),
  feedbackSettleSeconds: flagValueKind(NUMERIC_FLAGS.feedbackSettleSeconds),
  deliveryOrphanMinutes: flagValueKind(NUMERIC_FLAGS.deliveryOrphanMinutes),
  boardIdleDays: flagValueKind(NUMERIC_FLAGS.boardIdleDays),
  archiveGraceDays: flagValueKind(NUMERIC_FLAGS.archiveGraceDays),
  uploadTtlHours: flagValueKind(NUMERIC_FLAGS.uploadTtlHours),
  blobGraceHours: flagValueKind(NUMERIC_FLAGS.blobGraceHours),
  eventRetentionDays: flagValueKind(NUMERIC_FLAGS.eventRetentionDays),
} as const;

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
 * pauses writes.
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
        NUMERIC_FLAGS.maxFileBytes,
        LIMIT_DEFAULTS.maxFileBytes,
        flagValueSchema(NUMERIC_FLAGS.maxFileBytes),
      ),
      maxVersionBytes: flag(
        NUMERIC_FLAGS.maxVersionBytes,
        LIMIT_DEFAULTS.maxVersionBytes,
        flagValueSchema(NUMERIC_FLAGS.maxVersionBytes),
      ),
      maxFiles: flag(
        NUMERIC_FLAGS.maxFiles,
        LIMIT_DEFAULTS.maxFiles,
        flagValueSchema(NUMERIC_FLAGS.maxFiles),
      ),
      feedbackSettleSeconds: flag(
        NUMERIC_FLAGS.feedbackSettleSeconds,
        LIMIT_DEFAULTS.feedbackSettleSeconds,
        flagValueSchema(NUMERIC_FLAGS.feedbackSettleSeconds),
      ),
      deliveryOrphanMinutes: flag(
        NUMERIC_FLAGS.deliveryOrphanMinutes,
        LIMIT_DEFAULTS.deliveryOrphanMinutes,
        flagValueSchema(NUMERIC_FLAGS.deliveryOrphanMinutes),
      ),
      boardIdleDays: flag(
        NUMERIC_FLAGS.boardIdleDays,
        LIMIT_DEFAULTS.boardIdleDays,
        flagValueSchema(NUMERIC_FLAGS.boardIdleDays),
      ),
      archiveGraceDays: flag(
        NUMERIC_FLAGS.archiveGraceDays,
        LIMIT_DEFAULTS.archiveGraceDays,
        flagValueSchema(NUMERIC_FLAGS.archiveGraceDays),
      ),
      uploadTtlHours: flag(
        NUMERIC_FLAGS.uploadTtlHours,
        24,
        flagValueSchema(NUMERIC_FLAGS.uploadTtlHours),
      ),
      blobGraceHours: flag(
        NUMERIC_FLAGS.blobGraceHours,
        24,
        flagValueSchema(NUMERIC_FLAGS.blobGraceHours),
      ),
      eventRetentionDays: flag(
        NUMERIC_FLAGS.eventRetentionDays,
        30,
        flagValueSchema(NUMERIC_FLAGS.eventRetentionDays),
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

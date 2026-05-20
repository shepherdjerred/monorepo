import { z } from "zod";

export const LlmObservabilityConfigSchema = z.object({
  enabled: z.boolean(),
  archive: z.object({
    bucket: z.string().min(1),
    prefix: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.url(),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    sessionToken: z.string().optional(),
    forcePathStyle: z.boolean(),
  }),
  sampleRate: z.number().min(0).max(1),
});

export type LlmObservabilityConfig = z.infer<
  typeof LlmObservabilityConfigSchema
>;

type EnvLookup = Record<string, string | undefined>;

function requireEnv(env: EnvLookup, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(
      `llm-observability: required env var ${key} is missing; cannot enable LLM archive`,
    );
  }
  return value;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== "false" && value !== "0";
}

/**
 * Load the LLM observability config from the process environment.
 *
 * Three states:
 *   - `LLM_OBSERVABILITY_ENABLED=false`             → disabled (stub config).
 *   - `LLM_OBSERVABILITY_ENABLED=true` (default) + S3 envs present → enabled.
 *   - default + S3 envs missing                      → disabled (test/dev safe).
 *   - `LLM_OBSERVABILITY_ENABLED=true` explicit + S3 missing → throws.
 *
 * Production deployments inject `LLM_ARCHIVE_*` + `S3_*` together; tests and
 * `bun run dev` without those vars set get the no-op path. Setting
 * `LLM_OBSERVABILITY_ENABLED=true` explicitly is the way to force strictness.
 */
export function loadLlmObservabilityConfig(
  env: EnvLookup = Bun.env,
): LlmObservabilityConfig {
  const explicitlyEnabled = env["LLM_OBSERVABILITY_ENABLED"] === "true";
  const explicitlyDisabled = env["LLM_OBSERVABILITY_ENABLED"] === "false";
  const s3EndpointPresent =
    env["S3_ENDPOINT"] !== undefined && env["S3_ENDPOINT"] !== "";

  const enabled = explicitlyDisabled
    ? false
    : explicitlyEnabled
      ? true
      : s3EndpointPresent;

  if (!enabled) {
    // Return a stub config with the disabled flag — fields are still required
    // by Zod but won't be used. We supply harmless placeholders.
    return LlmObservabilityConfigSchema.parse({
      enabled: false,
      archive: {
        bucket: "disabled",
        prefix: "disabled",
        region: "us-east-1",
        endpoint: "http://disabled.invalid",
        accessKeyId: "disabled",
        secretAccessKey: "disabled",
        forcePathStyle: true,
      },
      sampleRate: 1,
    });
  }

  const sampleRateStr = env["LLM_ARCHIVE_SAMPLE_RATE"];
  const sampleRate =
    sampleRateStr === undefined ? 1 : Number.parseFloat(sampleRateStr);

  return LlmObservabilityConfigSchema.parse({
    enabled: true,
    archive: {
      bucket: env["LLM_ARCHIVE_S3_BUCKET"] ?? "llm-archive",
      prefix: env["LLM_ARCHIVE_S3_PREFIX"] ?? "llm",
      region: env["LLM_ARCHIVE_REGION"] ?? "us-east-1",
      endpoint: requireEnv(env, "S3_ENDPOINT"),
      accessKeyId: requireEnv(env, "AWS_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "AWS_SECRET_ACCESS_KEY"),
      sessionToken: env["AWS_SESSION_TOKEN"],
      forcePathStyle: parseBool(env["S3_FORCE_PATH_STYLE"], true),
    },
    sampleRate,
  });
}

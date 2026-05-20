import { EnvValue } from "cdk8s-plus-31";

/**
 * Env vars consumed by `@shepherdjerred/llm-observability`'s
 * `buildArchiveSpanProcessor`. Spread into a Deployment's `envVariables` next
 * to whichever pattern the service uses for `S3_ENDPOINT` /
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
 *
 * Defaults aim s3://llm-archive at SeaweedFS in `us-east-1`; per-service
 * overrides can pass partial overrides in the caller.
 */
export function llmArchiveEnvVars(): Record<string, EnvValue> {
  return {
    LLM_OBSERVABILITY_ENABLED: EnvValue.fromValue("true"),
    LLM_ARCHIVE_S3_BUCKET: EnvValue.fromValue("llm-archive"),
    LLM_ARCHIVE_S3_PREFIX: EnvValue.fromValue("llm"),
    LLM_ARCHIVE_REGION: EnvValue.fromValue("us-east-1"),
  };
}

import {
  loadLlmObservabilityConfig,
  type ArchiveConfig,
} from "@shepherdjerred/llm-observability";
import { z } from "zod";

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const ServiceConfigSchema = z.object({
  bearerToken: z.string().min(32),
  maxBodyBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  metricsPort: z.number().int().min(1).max(65_535),
  port: z.number().int().min(1).max(65_535),
  tempoOtlpHttpUrl: z.url(),
});

type EnvLookup = Record<string, string | undefined>;

export type BroadcastConfig = z.infer<typeof ServiceConfigSchema> & {
  archive: ArchiveConfig;
};

function required(env: EnvLookup, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`openrouter-broadcast-ingest: ${key} is required`);
  }
  return value;
}

function integerEnv(env: EnvLookup, key: string, fallback: number): number {
  const value = env[key];
  return value === undefined ? fallback : Number(value);
}

export function loadBroadcastConfig(env: EnvLookup = Bun.env): BroadcastConfig {
  const observability = loadLlmObservabilityConfig(env);
  if (!observability.enabled) {
    throw new Error(
      "openrouter-broadcast-ingest: LLM archive must be explicitly enabled",
    );
  }

  const service = ServiceConfigSchema.parse({
    bearerToken: required(env, "OPENROUTER_BROADCAST_BEARER_TOKEN"),
    maxBodyBytes: integerEnv(
      env,
      "OPENROUTER_BROADCAST_MAX_BODY_BYTES",
      DEFAULT_MAX_BODY_BYTES,
    ),
    metricsPort: integerEnv(env, "METRICS_PORT", 9090),
    port: integerEnv(env, "PORT", 3000),
    tempoOtlpHttpUrl:
      env["TEMPO_OTLP_HTTP_URL"] ??
      "http://tempo.tempo.svc.cluster.local:4318/v1/traces",
  });

  if (service.port === service.metricsPort) {
    throw new Error(
      "openrouter-broadcast-ingest: PORT and METRICS_PORT must differ",
    );
  }

  return { ...service, archive: observability.archive };
}

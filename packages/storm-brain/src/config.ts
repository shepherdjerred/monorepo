import { defineConfig } from "@shepherdjerred/config";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { requireNativeRoute } from "@shepherdjerred/llm-models";
import { z } from "zod";

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

const ModelConfigDefinition = {
  model: {
    schema: z.string().min(1),
    sources: ["flag", "default"],
    default: DEFAULT_MODEL,
    names: { flag: "storm-brain-model" },
  },
} as const;

const ServiceConfigSchema = z.object({
  bearerToken: z.string().min(32),
  model: z.string().min(1),
  maxBodyBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024),
  llmTimeoutMs: z.number().int().positive().max(300_000),
  metricsPort: z.number().int().min(1).max(65_535),
  port: z.number().int().min(1).max(65_535),
});

export type BrainConfig = z.infer<typeof ServiceConfigSchema>;

type EnvLookup = Record<string, string | undefined>;

function required(env: EnvLookup, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`storm-brain: ${key} is required`);
  }
  return value;
}

function integer(env: EnvLookup, key: string, fallback: number): number {
  const value = env[key];
  return value === undefined || value === "" ? fallback : Number(value);
}

export type BrainConfigOptions = {
  readonly environment?: EnvLookup;
  readonly flagSource?: ConfigSource;
};

export async function loadBrainConfig(
  options: BrainConfigOptions = {},
): Promise<BrainConfig> {
  const env = options.environment ?? Bun.env;
  const resolver = defineConfig({
    definition: ModelConfigDefinition,
    sources: {
      ...(options.flagSource === undefined ? {} : { flag: options.flagSource }),
    },
  });
  const config = ServiceConfigSchema.parse({
    bearerToken: required(env, "STORM_BRAIN_BEARER_TOKEN"),
    model: await resolver.value("model"),
    maxBodyBytes: integer(
      env,
      "STORM_BRAIN_MAX_BODY_BYTES",
      DEFAULT_MAX_BODY_BYTES,
    ),
    llmTimeoutMs: integer(
      env,
      "STORM_BRAIN_LLM_TIMEOUT_MS",
      DEFAULT_LLM_TIMEOUT_MS,
    ),
    metricsPort: integer(env, "METRICS_PORT", 9090),
    port: integer(env, "PORT", 3000),
  });

  if (config.port === config.metricsPort) {
    throw new Error("storm-brain: PORT and METRICS_PORT must differ");
  }
  // Fail fast on an unknown model or one without a native provider route.
  // Provider credentials are validated when the brain is constructed.
  requireNativeRoute(config.model);

  return config;
}

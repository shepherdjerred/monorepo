import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createObservabilityHooks } from "@shepherdjerred/config/observability.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { createLogger } from "#src/logger.ts";
import { featureFlagMetrics } from "#src/metrics/feature-flags.ts";
import configuration from "#src/configuration.ts";

const logger = createLogger("config-dynamic");

/**
 * Scout's dynamically configurable values.
 *
 * Bootstrap stays in `configuration.ts` — env-only by definition, read before
 * a flag client could exist. This module owns only what an operator should be
 * able to change without a deploy.
 *
 * ## Why these are read through a synchronous snapshot
 *
 * Resolution is async because the flag layer is, but both call sites here are
 * synchronous and cannot become async without real risk:
 *
 * - `exploreAllowlist()` is handed to Discord guild command registration as a
 *   `() => string[]`. An empty array there does not disable a feature — it
 *   UNREGISTERS `/scout` in every guild.
 * - `assertWithinBudget()` runs before every model generation, on the money
 *   path.
 *
 * The snapshot is seeded with today's env-derived values, so a read before the
 * first refresh is byte-identical to current behavior, and a failed refresh
 * keeps the last good value rather than reverting.
 */
const DEFINITION = {
  /**
   * Discord servers allowed to use explore.
   *
   * Explore reads the whole match lake, so this is the entire gate for that
   * surface. Empty denies everyone, deliberately: "not configured" must mean
   * "nobody", never "everybody". That property survives the migration — with
   * Flipt unreachable the env layer answers, and with neither the default is
   * an empty list.
   */
  exploreGuildAllowlist: {
    schema: z.union([
      z.array(z.string()),
      // Env supplies a comma-separated string.
      z.string().transform((raw) =>
        raw
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    ]),
    sources: ["flag", "env", "default"],
    default: [],
    names: { env: "EXPLORE_GUILD_ALLOWLIST" },
  },
  llmHourlyTokenBudget: {
    schema: z.coerce.number().int().positive(),
    sources: ["flag", "env", "default"],
    default: 2_000_000,
  },
  llmDailyTokenBudget: {
    schema: z.coerce.number().int().positive(),
    sources: ["flag", "env", "default"],
    default: 20_000_000,
  },
  reportAiModel: {
    schema: z.string().trim().min(1),
    sources: ["flag", "env", "default"],
    default: "gpt-5.6-sol",
    names: { flag: "scout-report-ai-model", env: "REPORT_AI_MODEL" },
  },
  bettingParlayAiModel: {
    schema: z.string().trim().min(1),
    sources: ["flag", "env", "default"],
    default: "gpt-5.6-sol",
    names: {
      flag: "scout-betting-parlay-ai-model",
      env: "BETTING_PARLAY_AI_MODEL",
    },
  },
  exploreModel: {
    schema: z.string().trim().min(1),
    sources: ["flag", "env", "default"],
    default: "gpt-5.6-sol",
    names: { flag: "scout-explore-model", env: "EXPLORE_MODEL" },
  },
  bucksAskModel: {
    schema: z.string().trim().min(1),
    sources: ["flag", "env", "default"],
    default: "gpt-5.6-luna",
    names: { flag: "scout-bucks-ask-model", env: "BB_ASK_MODEL" },
  },
} as const;

const REFRESH_INTERVAL_MS = 60_000;

type Snapshot = ReturnType<typeof buildSnapshot>;

function buildSnapshot(
  environment: Readonly<Record<string, string | undefined>>,
  seed: {
    exploreGuildAllowlist: string[];
    llmHourlyTokenBudget: number;
    llmDailyTokenBudget: number;
    reportAiModel?: string;
    bettingParlayAiModel?: string;
    exploreModel?: string;
    bucksAskModel?: string;
  },
  flagSourceEnabled: boolean,
) {
  const resolver = defineConfig({
    definition: DEFINITION,
    sources: {
      ...(flagSourceEnabled
        ? {
            flag: createFlagConfigSource({
              targetingKey: "scout-backend",
              kinds: {
                exploreGuildAllowlist: "string",
                llmHourlyTokenBudget: "number",
                llmDailyTokenBudget: "number",
                reportAiModel: "string",
                bettingParlayAiModel: "string",
                exploreModel: "string",
                bucksAskModel: "string",
              },
            }),
          }
        : {}),
      env: createEnvSource(environment),
    },
    hooks: createObservabilityHooks({
      log: (message) => {
        logger.info(message);
      },
    }),
  });

  return createConfigSnapshot({
    resolver,
    seed,
    onRefreshError: (key, message) => {
      logger.warn(`config refresh failed for ${key}; keeping last value`, {
        message,
      });
    },
  });
}

let snapshot: Snapshot | undefined;

export type InitializeDynamicConfigOptions = {
  readonly environment?: InitFeatureFlagsOptions["environment"];
  readonly provider?: InitFeatureFlagsOptions["provider"];
  readonly metrics?: InitFeatureFlagsOptions["metrics"];
  readonly seed: {
    exploreGuildAllowlist: string[];
    llmHourlyTokenBudget: number;
    llmDailyTokenBudget: number;
    reportAiModel?: string;
    bettingParlayAiModel?: string;
    exploreModel?: string;
    bucksAskModel?: string;
  };
  /** Tests pass false to avoid an interval. */
  readonly startPolling?: boolean;
};

/**
 * Starts the flag client and performs the first refresh.
 *
 * A flag backend that is unreachable is not fatal: keys fall through to env and
 * their defaults, which are exactly the values seeded here.
 */
export async function initializeDynamicConfig(
  options: InitializeDynamicConfigOptions,
): Promise<void> {
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    metrics: options.metrics ?? featureFlagMetrics,
    onInitializationFailure: (message) => {
      logger.warn(message);
    },
  });
  snapshot = buildSnapshot(options.environment ?? Bun.env, options.seed, true);
  await snapshot.refresh();
  if (options.startPolling !== false) {
    snapshot.start(REFRESH_INTERVAL_MS);
  }
}

/** Whether dynamic config has been initialized. */
export function isDynamicConfigReady(): boolean {
  return snapshot !== undefined;
}

export function exploreGuildAllowlist(): string[] {
  return (
    snapshot?.get("exploreGuildAllowlist") ??
    configuration.exploreGuildAllowlist
  );
}

export function llmHourlyTokenBudget(): number {
  return (
    snapshot?.get("llmHourlyTokenBudget") ?? configuration.llmHourlyTokenBudget
  );
}

export function llmDailyTokenBudget(): number {
  return (
    snapshot?.get("llmDailyTokenBudget") ?? configuration.llmDailyTokenBudget
  );
}

export function reportAiModel(): string {
  return (
    snapshot?.get("reportAiModel") ??
    configuration.reportAiModel ??
    "gpt-5.6-sol"
  );
}

export function bettingParlayAiModel(): string {
  return (
    snapshot?.get("bettingParlayAiModel") ??
    configuration.bettingParlayAiModel ??
    "gpt-5.6-sol"
  );
}

export function exploreModel(): string {
  return snapshot?.get("exploreModel") ?? configuration.exploreModel;
}

export function bucksAskModel(): string {
  return snapshot?.get("bucksAskModel") ?? configuration.bucksAskModel;
}

export async function shutdownDynamicConfig(): Promise<void> {
  snapshot?.stop();
  snapshot = undefined;
  await shutdownFeatureFlags();
}

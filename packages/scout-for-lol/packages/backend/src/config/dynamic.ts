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
import { featureFlagMetrics } from "#src/metrics/platform/feature-flags.ts";
import configuration from "#src/configuration.ts";
import {
  DEFAULT_EXPLORE_QUOTA_LIMITS,
  ExploreQuotaLimitsInputSchema,
  type ExploreQuotaLimits,
} from "#src/configuration/explore-quota.ts";

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
 * - `exploreAllowlist()` is handed to beta's Discord guild command
 *   registration as a `() => string[]`. An empty array there does not merely
 *   disable a feature — it unregisters `/scout` in every beta guild.
 * - `assertWithinBudget()` runs before every model generation, on the money
 *   path.
 *
 * The snapshot is seeded with today's env-derived values, so a read before the
 * first refresh is byte-identical to current behavior, and a failed refresh
 * keeps the last good value rather than reverting.
 */
const DEFINITION = {
  /**
   * Discord servers allowed to use Explore in beta.
   *
   * Explore reads the whole match lake, so this is beta's entire gate. Empty
   * denies everyone deliberately. Production instead verifies that the caller
   * shares a live connected guild with the production bot.
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
  /**
   * Explore's question ceilings, as one object.
   *
   * Flag-capable because these bound model spend: a cost surprise should be
   * answerable by moving the ceiling, not by waiting for a deploy. The schema
   * rejects a partially-sane policy rather than letting one through, since an
   * unreachable window refuses requests while naming a limit the caller has
   * not actually reached.
   */
  exploreQuotaLimits: {
    schema: ExploreQuotaLimitsInputSchema,
    sources: ["flag", "env", "default"],
    default: DEFAULT_EXPLORE_QUOTA_LIMITS,
    names: {
      flag: "scout-explore-quota-limits",
      env: "EXPLORE_QUOTA_LIMITS",
    },
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
    default: "gpt-5.6-luna",
    names: { flag: "scout-explore-model", env: "EXPLORE_MODEL" },
  },
  /**
   * Percent of eligible messages that carry a feature tip. The roll is only
   * reached after the audience's cooldown has expired and an unused, available
   * tip exists, so this bounds noise within that set rather than overall.
   */
  featureTipPercent: {
    schema: z.coerce.number().int().min(0).max(100),
    sources: ["flag", "env", "default"],
    default: 10,
    names: {
      flag: "scout-feature-tip-percent",
      env: "FEATURE_TIP_PERCENT",
    },
  },
  /**
   * Minimum hours between two tips to the same audience. A busy server must
   * not out-earn a quiet one on tips, so pacing is time-based, not volume-based.
   */
  featureTipCooldownHours: {
    schema: z.coerce.number().int().positive(),
    sources: ["flag", "env", "default"],
    default: 72,
    names: {
      flag: "scout-feature-tip-cooldown-hours",
      env: "FEATURE_TIP_COOLDOWN_HOURS",
    },
  },
  temporalCallGraphTracing: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "scout-temporal-call-graph-tracing" },
  },
} as const;

/**
 * The values the snapshot starts from, so a read before the first refresh is
 * byte-identical to the env-derived behaviour that preceded it.
 */
export type DynamicConfigSeed = {
  exploreGuildAllowlist: string[];
  exploreQuotaLimits: ExploreQuotaLimits;
  llmHourlyTokenBudget: number;
  llmDailyTokenBudget: number;
  reportAiModel?: string;
  bettingParlayAiModel?: string;
  exploreModel?: string;
  featureTipPercent?: number;
  featureTipCooldownHours?: number;
  // Required, unlike the rest: `temporalCallGraphTracing()` is read
  // unconditionally at boot, and `snapshot.get` throws on an unseeded key. Its
  // `?? false` guards a null snapshot, not that throw — so an optional field
  // here let the key ship unseeded and killed the backend at startup.
  temporalCallGraphTracing: boolean;
};

const REFRESH_INTERVAL_MS = 60_000;

type Snapshot = ReturnType<typeof buildSnapshot>;

function buildSnapshot(
  environment: Readonly<Record<string, string | undefined>>,
  seed: DynamicConfigSeed,
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
                // A JSON object arrives as a string, like the allowlist.
                exploreQuotaLimits: "string",
                llmHourlyTokenBudget: "number",
                llmDailyTokenBudget: "number",
                reportAiModel: "string",
                bettingParlayAiModel: "string",
                exploreModel: "string",
                featureTipPercent: "number",
                featureTipCooldownHours: "number",
                temporalCallGraphTracing: "boolean",
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
let pollTimer: ReturnType<typeof setInterval> | undefined;
const refreshListeners = new Set<() => Promise<void>>();

export function addDynamicConfigRefreshListener(
  listener: () => Promise<void>,
): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

async function notifyRefreshListeners(): Promise<void> {
  for (const listener of refreshListeners) {
    await listener();
  }
}

async function refreshDynamicConfigAndNotify(): Promise<void> {
  try {
    await refreshDynamicConfig();
  } catch (error: unknown) {
    logger.error("dynamic config refresh listener failed", { error });
  }
}

export type InitializeDynamicConfigOptions = {
  readonly environment?: InitFeatureFlagsOptions["environment"];
  readonly provider?: InitFeatureFlagsOptions["provider"];
  readonly metrics?: InitFeatureFlagsOptions["metrics"];
  readonly seed: DynamicConfigSeed;
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
    pollTimer ??= setInterval(() => {
      void refreshDynamicConfigAndNotify();
    }, REFRESH_INTERVAL_MS);
    pollTimer.unref();
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

/**
 * Read per request rather than captured at module load, so an operator's
 * change lands on the next question instead of the next deploy.
 */
export function exploreQuotaLimits(): ExploreQuotaLimits {
  return (
    snapshot?.get("exploreQuotaLimits") ?? configuration.exploreQuotaLimits
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

export async function refreshDynamicConfig(): Promise<void> {
  if (snapshot === undefined) {
    return;
  }
  await snapshot.refresh();
  await notifyRefreshListeners();
}

export function featureTipPercent(): number {
  return snapshot?.get("featureTipPercent") ?? configuration.featureTipPercent;
}

export function featureTipCooldownHours(): number {
  return (
    snapshot?.get("featureTipCooldownHours") ??
    configuration.featureTipCooldownHours
  );
}

/** Boot-wired: a changed value takes effect only after the worker restarts. */
export function temporalCallGraphTracing(): boolean {
  return snapshot?.get("temporalCallGraphTracing") ?? false;
}

export async function shutdownDynamicConfig(): Promise<void> {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  refreshListeners.clear();
  snapshot = undefined;
  await shutdownFeatureFlags();
}

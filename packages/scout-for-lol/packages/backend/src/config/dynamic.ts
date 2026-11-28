import configuration from "#src/configuration.ts";
import {
  DEFAULT_EXPLORE_QUOTA_LIMITS,
  type ExploreQuotaLimits,
} from "#src/configuration/explore-quota.ts";
import { DEFAULT_EXPLORE_SPEND_POLICY } from "#src/configuration/explore-spend.ts";
import { createLogger } from "#src/logger.ts";
import { featureFlagMetrics } from "#src/metrics/platform/feature-flags.ts";
import { defineConfig } from "@shepherdjerred/config";
import { createObservabilityHooks } from "@shepherdjerred/config/observability.ts";
import { createConfigSnapshot } from "@shepherdjerred/config/snapshot.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import { parseFlagsDeployment } from "@shepherdjerred/feature-flags/config/schema.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod";
import type { RiotBudgetMode } from "#src/league/api/client/rate-budget.ts";

const logger = createLogger("config-dynamic");

const EVIDENCE_RECOVERY_FLAG = "scout-evidence-recovery-enabled";

/** The stage whose managed defaults a Scout process starts from. */
function managedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): "prod" | "beta" {
  const deploymentStage =
    environment["FLAGS_DEPLOYMENT"] === undefined
      ? undefined
      : parseFlagsDeployment(environment["FLAGS_DEPLOYMENT"])?.stage;
  return (deploymentStage ?? environment["ENVIRONMENT"]) === "prod"
    ? "prod"
    : "beta";
}

/**
 * The evidence-recovery value a process uses when no flag answers: the managed
 * inventory's default for its environment (on in beta, off in prod).
 */
export function evidenceRecoveryDefault(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return managedBooleanDefault(
    EVIDENCE_RECOVERY_FLAG,
    managedEnvironment(environment),
  );
}

/**
 * How long, in seconds, an end-of-game record waits after its upload for the
 * same game's history bundle and pending aliases before it freezes as the
 * game's canonical match.
 *
 * Measured on beta (read-only, every accepted `post_game` observation from
 * 2026-09-23 to 2026-11-09): of 37 games that had both, 32 bundles followed
 * the end-of-game block within an hour, with p50 12 s, p90 201 s, p95 236 s
 * and a 771 s maximum. The other five came 2 to 91 hours later, after the
 * app restarted; those are recovery, not the live window. 360 s covers the
 * live p95 with half again as margin; 81 games had no bundle at all.
 */
export const DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS = 360;

/** The first step of the plan's budget ladder: 1k matches a day, on beta. */
export const DEFAULT_PARTICIPANT_CRAWL_DAILY_MATCH_BUDGET = 1000;

/**
 * The oldest Scout Client build check-in and observation batch accept.
 *
 * Every build released so far is 0.1.0, so the default refuses none of them.
 * Raising it is an operator Flags change; a build below it gets the typed
 * `client_upgrade_required` refusal and keeps its outbox until it upgrades.
 */
export const DEFAULT_SCOUT_CLIENT_MINIMUM_VERSION = "0.1.0";

/** A strict semantic version, as a Scout Client reports its own build. */
export const SemanticVersionSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i,
  );

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
  exploreSpendPolicy: {
    schema: flagValueSchema("scout-explore-spend-policy"),
    sources: ["flag", "default"],
    default: DEFAULT_EXPLORE_SPEND_POLICY,
    names: { flag: "scout-explore-spend-policy" },
  },
  exploreAnalysisEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "scout-explore-analysis-enabled" },
  },
  exploreModelPickerEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "scout-explore-model-picker-enabled" },
  },
  /**
   * Discord servers allowed to use Explore in beta.
   *
   * Explore reads the whole match lake, so this is beta's entire gate. Empty
   * denies everyone deliberately. Production instead verifies that the caller
   * shares a live connected guild with the production bot.
   */
  exploreGuildAllowlist: {
    // Flags and env supply comma-separated guild ids; "" denies every guild.
    schema: flagValueSchema("explore-guild-allowlist").transform((raw) =>
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
    sources: ["flag", "env", "default"],
    default: "",
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
    schema: flagValueSchema("scout-explore-quota-limits"),
    sources: ["flag", "env", "default"],
    default: DEFAULT_EXPLORE_QUOTA_LIMITS,
    names: {
      flag: "scout-explore-quota-limits",
      env: "EXPLORE_QUOTA_LIMITS",
    },
  },
  llmHourlyTokenBudget: {
    schema: flagValueSchema("llm-hourly-token-budget"),
    sources: ["flag", "env", "default"],
    default: 2_000_000,
  },
  llmDailyTokenBudget: {
    schema: flagValueSchema("llm-daily-token-budget"),
    sources: ["flag", "env", "default"],
    default: 20_000_000,
  },
  reportAiModel: {
    schema: flagValueSchema("scout-report-ai-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6.1-sol",
    names: { flag: "scout-report-ai-model", env: "REPORT_AI_MODEL" },
  },
  exploreModel: {
    schema: flagValueSchema("scout-explore-model"),
    sources: ["flag", "env", "default"],
    default: "gpt-6-luna",
    names: { flag: "scout-explore-model", env: "EXPLORE_MODEL" },
  },
  /**
   * Percent of eligible messages that carry a feature tip. The roll is only
   * reached after the audience's cooldown has expired and an unused, available
   * tip exists, so this bounds noise within that set rather than overall.
   */
  featureTipPercent: {
    schema: flagValueSchema("scout-feature-tip-percent"),
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
    schema: flagValueSchema("scout-feature-tip-cooldown-hours"),
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
  /**
   * The evidence-recovery contract for Riot match processing: admission,
   * history recovery, timelines, raw Riot capture, source reads, lake
   * eligibility and report scoreboards.
   *
   * Boot-pinned: the value is captured once after the first refresh and never
   * moves for the life of the process, so one worker never mixes two
   * processing contracts. A Flags change takes effect on the next restart. Its
   * default is the managed environment default (on in beta, off in prod),
   * independent of `scout_client_ingestion`.
   */
  evidenceRecoveryEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: EVIDENCE_RECOVERY_FLAG },
  },
  /**
   * Whether the Riot rate limiter only records the budget ledger's decisions
   * (`observe`) or holds requests the ledger refuses (`enforce`). Read per
   * request attempt. `enforce` waits on zero realtime `would_defer` across
   * 50k realtime requests.
   */
  riotBudgetMode: {
    schema: flagValueSchema("scout-riot-budget-mode"),
    sources: ["flag", "default"],
    default: "observe",
    names: { flag: "scout-riot-budget-mode" },
  },
  /**
   * Whether the participant crawl runs. Off everywhere by default; production
   * stays hard-disabled in code (`crawl/crawl-config.ts`) until deletion, the
   * privacy page and the Riot declaration are live, whatever this answers.
   */
  participantCrawlEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "scout-participant-crawl-enabled" },
  },
  /**
   * Kill switch for the daily rank refresh (`league/rank-refresh/`). A
   * process's code default is the managed inventory's for its environment
   * (on in beta, off in production).
   */
  scoutRankRefreshEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "scout-rank-refresh-enabled" },
  },
  /** Matches the participant crawl may store per UTC day. */
  participantCrawlDailyMatchBudget: {
    schema: flagValueSchema("scout-participant-crawl-daily-match-budget"),
    sources: ["flag", "default"],
    default: DEFAULT_PARTICIPANT_CRAWL_DAILY_MATCH_BUDGET,
    names: { flag: "scout-participant-crawl-daily-match-budget" },
  },
  /** See {@link DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS}. */
  scoutClientEndOfGameDeadlineSeconds: {
    schema: flagValueSchema("scout-client-end-of-game-deadline-seconds"),
    sources: ["flag", "default"],
    default: DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS,
    names: { flag: "scout-client-end-of-game-deadline-seconds" },
  },
  /** See {@link DEFAULT_SCOUT_CLIENT_MINIMUM_VERSION}. */
  scoutClientMinimumVersion: {
    schema: flagValueSchema("scout-client-minimum-version"),
    sources: ["flag", "default"],
    default: DEFAULT_SCOUT_CLIENT_MINIMUM_VERSION,
    names: { flag: "scout-client-minimum-version" },
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
  // On in beta and off in production when no flag answers.
  const rankRefreshDefault = managedBooleanDefault(
    "scout-rank-refresh-enabled",
    managedEnvironment(environment),
  );
  const resolver = defineConfig({
    definition: {
      ...DEFINITION,
      temporalCallGraphTracing: {
        ...DEFINITION.temporalCallGraphTracing,
        default: managedBooleanDefault(
          "scout-temporal-call-graph-tracing",
          managedEnvironment(environment),
        ),
      },
      evidenceRecoveryEnabled: {
        ...DEFINITION.evidenceRecoveryEnabled,
        default: evidenceRecoveryDefault(environment),
      },
      scoutRankRefreshEnabled: {
        ...DEFINITION.scoutRankRefreshEnabled,
        default: rankRefreshDefault,
      },
    },
    sources: {
      ...(flagSourceEnabled
        ? {
            flag: createFlagConfigSource({
              targetingKey: "scout-backend",
              kinds: {
                exploreGuildAllowlist: flagValueKind("explore-guild-allowlist"),
                exploreQuotaLimits: flagValueKind("scout-explore-quota-limits"),
                exploreSpendPolicy: flagValueKind("scout-explore-spend-policy"),
                llmHourlyTokenBudget: flagValueKind("llm-hourly-token-budget"),
                llmDailyTokenBudget: flagValueKind("llm-daily-token-budget"),
                reportAiModel: flagValueKind("scout-report-ai-model"),
                exploreModel: flagValueKind("scout-explore-model"),
                featureTipPercent: flagValueKind("scout-feature-tip-percent"),
                featureTipCooldownHours: flagValueKind(
                  "scout-feature-tip-cooldown-hours",
                ),
                temporalCallGraphTracing: "boolean",
                exploreAnalysisEnabled: "boolean",
                exploreModelPickerEnabled: "boolean",
                evidenceRecoveryEnabled: "boolean",
                riotBudgetMode: flagValueKind("scout-riot-budget-mode"),
                participantCrawlEnabled: "boolean",
                scoutRankRefreshEnabled: "boolean",
                participantCrawlDailyMatchBudget: flagValueKind(
                  "scout-participant-crawl-daily-match-budget",
                ),
                scoutClientEndOfGameDeadlineSeconds: flagValueKind(
                  "scout-client-end-of-game-deadline-seconds",
                ),
                scoutClientMinimumVersion: flagValueKind(
                  "scout-client-minimum-version",
                ),
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
    seed: {
      exploreSpendPolicy: DEFAULT_EXPLORE_SPEND_POLICY,
      exploreAnalysisEnabled: false,
      exploreModelPickerEnabled: false,
      evidenceRecoveryEnabled: evidenceRecoveryDefault(environment),
      riotBudgetMode: "observe",
      participantCrawlEnabled: false,
      scoutRankRefreshEnabled: rankRefreshDefault,
      participantCrawlDailyMatchBudget:
        DEFAULT_PARTICIPANT_CRAWL_DAILY_MATCH_BUDGET,
      scoutClientEndOfGameDeadlineSeconds:
        DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS,
      scoutClientMinimumVersion: DEFAULT_SCOUT_CLIENT_MINIMUM_VERSION,
      ...seed,
    },
    onRefreshError: (key, message) => {
      logger.warn(`config refresh failed for ${key}; keeping last value`, {
        message,
      });
    },
  });
}

let snapshot: Snapshot | undefined;
let evidenceRecoveryAtBoot: boolean | undefined;
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
  evidenceRecoveryAtBoot = snapshot.get("evidenceRecoveryEnabled");
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
    "gpt-6.1-sol"
  );
}

export function exploreModel(): string {
  return snapshot?.get("exploreModel") ?? configuration.exploreModel;
}

export const DEFAULT_EXPLORE_PICKER_MODEL = "gpt-6-luna";

/** Resolve and pin the model selected for a new Explore turn. */
export function resolveExploreModel(
  requestedModel?: string,
  preferredModel?: string | null,
): string {
  return exploreModelPickerEnabled()
    ? (requestedModel ?? preferredModel ?? DEFAULT_EXPLORE_PICKER_MODEL)
    : exploreModel();
}

export function exploreAnalysisEnabled(): boolean {
  return snapshot?.get("exploreAnalysisEnabled") ?? false;
}
export function exploreModelPickerEnabled(): boolean {
  return snapshot?.get("exploreModelPickerEnabled") ?? false;
}
export function exploreSpendPolicy() {
  return snapshot?.get("exploreSpendPolicy") ?? DEFAULT_EXPLORE_SPEND_POLICY;
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

/**
 * Read per resolution, so a changed deadline applies to the next readiness
 * check. Only games still waiting see it; a frozen record never changes.
 */
export function scoutClientEndOfGameDeadlineSeconds(): number {
  return (
    snapshot?.get("scoutClientEndOfGameDeadlineSeconds") ??
    DEFAULT_SCOUT_CLIENT_END_OF_GAME_DEADLINE_SECONDS
  );
}

/** Read per request, so a raised minimum applies to the next check-in. */
export function scoutClientMinimumVersion(): string {
  return (
    snapshot?.get("scoutClientMinimumVersion") ??
    DEFAULT_SCOUT_CLIENT_MINIMUM_VERSION
  );
}

/** Boot-wired: a changed value takes effect only after the worker restarts. */
export function temporalCallGraphTracing(): boolean {
  return snapshot?.get("temporalCallGraphTracing") ?? false;
}

/**
 * The evidence-recovery decision captured when this process initialized
 * dynamic config, or `undefined` before initialization. Later refreshes never
 * change it; read it through `evidence/recovery-gate.ts`.
 */
export function evidenceRecoveryBootDecision(): boolean | undefined {
  return evidenceRecoveryAtBoot;
}

/** Per-attempt read by the Riot rate limiter; `observe` until refreshed. */
export function riotBudgetMode(): RiotBudgetMode {
  return snapshot?.get("riotBudgetMode") ?? "observe";
}

/** Per-tick read by the participant crawl; the flag's answer, `false` until refreshed. */
export function participantCrawlEnabled(): boolean {
  return snapshot?.get("participantCrawlEnabled") ?? false;
}

/**
 * Per-batch read by the rank refresh. Before the first refresh it answers
 * `false`, so an Activity that outruns configuration boot does nothing.
 */
export function scoutRankRefreshEnabled(): boolean {
  return snapshot?.get("scoutRankRefreshEnabled") ?? false;
}

/** Per-tick read by the participant crawl: matches it may store per UTC day. */
export function participantCrawlDailyMatchBudget(): number {
  return (
    snapshot?.get("participantCrawlDailyMatchBudget") ??
    DEFAULT_PARTICIPANT_CRAWL_DAILY_MATCH_BUDGET
  );
}

export async function shutdownDynamicConfig(): Promise<void> {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  refreshListeners.clear();
  snapshot = undefined;
  evidenceRecoveryAtBoot = undefined;
  await shutdownFeatureFlags();
}

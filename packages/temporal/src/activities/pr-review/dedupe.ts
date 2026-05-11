import { RedisClient } from "bun";
import { withSpan } from "#observability/tracing.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import {
  cosineSimilarity,
  embedClaim,
  type EmbedDeps,
} from "#lib/pr-review/embedding.ts";
import {
  dismissalKey,
  readEntries,
  scanSimilarity,
  type RedisSend,
} from "#lib/pr-review/dismissed-store.ts";
import {
  prReviewDedupeDropTotal,
  prReviewDedupeRedisErrorTotal,
} from "#observability/pr-review-metrics.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Cosine threshold above which two normalized claims are treated as
 * "the same finding" for dedupe purposes. Tunable via the `pr-review-bot`
 * ConfigMap (Phase 9 of the SOTA plan) — values outside [0.70, 0.95]
 * are clamped on read to prevent foot-guns.
 */
const DEFAULT_COSINE_THRESHOLD = 0.85;
const COSINE_THRESHOLD_MIN = 0.7;
const COSINE_THRESHOLD_MAX = 0.95;

/**
 * Cumulative weight at which a finding is considered dismissed.
 * Single thumbs-down (weight 1.0) trips immediately; two weaker
 * resolved-without-followup signals (0.5 each) also dismiss together.
 */
const CUMULATIVE_WEIGHT_THRESHOLD = 1;

export type DedupeInput = {
  owner: string;
  repo: string;
  findings: Finding[];
};

/**
 * Lazily-instantiated singleton RedisClient. Bun's `RedisClient` pools
 * connections internally; sharing one instance across activity calls is
 * the documented pattern. `null` while REDIS_URL is unset.
 */
let cachedRedis: RedisClient | null = null;
let cachedRedisUrl: string | null = null;

export function getRedis(url?: string): RedisSend | null {
  const target = url ?? Bun.env["REDIS_URL"] ?? "";
  if (target === "") return null;
  if (cachedRedis !== null && cachedRedisUrl === target) return cachedRedis;
  cachedRedis = new RedisClient(target);
  cachedRedisUrl = target;
  return cachedRedis;
}

/**
 * For testing: reset the singleton between unit tests so each test can
 * inject its own mock client.
 */
export function _resetRedisForTest(): void {
  cachedRedis = null;
  cachedRedisUrl = null;
}

/**
 * Normalized claim string used for both hashing and embedding. Stable
 * across whitespace and case so that two claims that differ only in
 * formatting cluster together.
 */
export function normalizeClaim(claim: string): string {
  return claim.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function clampThreshold(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_COSINE_THRESHOLD;
  if (raw < COSINE_THRESHOLD_MIN) return COSINE_THRESHOLD_MIN;
  if (raw > COSINE_THRESHOLD_MAX) return COSINE_THRESHOLD_MAX;
  return raw;
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "dedupeAgainstHistory",
      ...fields,
    }),
  );
}

export type DedupeDeps = {
  /** Override for tests; defaults to the lazy-singleton from `getRedis()`. */
  readonly redis?: RedisSend | null;
  /** Override for tests; defaults to env-driven embedding stack. */
  readonly embed?: EmbedDeps;
  /** Override for tests; clamps to [0.70, 0.95] from ConfigMap value. */
  readonly cosineThreshold?: number;
};

async function dedupeAgainstHistoryImpl(
  input: DedupeInput,
  deps: DedupeDeps = {},
): Promise<Finding[]> {
  return await withSpan(
    "prReview.dedupeAgainstHistory",
    {
      "findings.input": input.findings.length,
      "pr.owner": input.owner,
      "pr.repo": input.repo,
    },
    async () => {
      if (input.findings.length === 0) return [];

      const redis = deps.redis === undefined ? getRedis() : deps.redis;
      if (redis === null) {
        // Redis is misconfigured (REDIS_URL unset) — fail-closed: no
        // dedupe, keep everything. Logged for operator visibility.
        prReviewDedupeRedisErrorTotal.inc({ stage: "connect" });
        jsonLog("warning", "REDIS_URL unset; skipping dedupe", {
          inputCount: input.findings.length,
        });
        return input.findings;
      }

      const cosineThresholdRaw =
        deps.cosineThreshold ??
        Number(Bun.env["PR_REVIEW_DEDUPE_COSINE_THRESHOLD"] ?? "");
      const cosineThreshold = clampThreshold(cosineThresholdRaw);

      const kept: Finding[] = [];
      let droppedTotal = 0;

      for (const finding of input.findings) {
        const key = dismissalKey(
          input.owner,
          input.repo,
          finding.file,
          finding.kind,
        );

        const entries = await readEntries(redis, key);
        if (entries.length === 0) {
          kept.push(finding);
          continue;
        }

        const embedding = await embedClaim(
          normalizeClaim(finding.claim),
          deps.embed ?? {},
        );
        if (embedding === null) {
          // Embedding stack unavailable (both Voyage and local failed):
          // fail-closed. Keep the finding; user can dismiss again if needed.
          kept.push(finding);
          continue;
        }

        const scan = scanSimilarity({
          entries,
          candidate: embedding.vector,
          cosineThreshold,
          cosine: cosineSimilarity,
        });

        if (scan.cumulativeWeight >= CUMULATIVE_WEIGHT_THRESHOLD) {
          droppedTotal += 1;
          prReviewDedupeDropTotal.inc({
            repo: input.repo,
            kind: finding.kind,
            reason: "dismissed-similar",
          });
          jsonLog("info", "dropped finding via dismissed-comment dedupe", {
            file: finding.file,
            kind: finding.kind,
            cumulativeWeight: scan.cumulativeWeight,
            bestSim: scan.bestSim,
            matchedCount: scan.matchedCount,
            provider: embedding.provider,
          });
          continue;
        }
        kept.push(finding);
      }

      jsonLog("info", "dedupeAgainstHistory completed", {
        inputCount: input.findings.length,
        keptCount: kept.length,
        droppedCount: droppedTotal,
        cosineThreshold,
      });
      return kept;
    },
  );
}

/** Exposed for unit tests to drive the implementation with injected deps. */
export const _dedupeAgainstHistoryImpl = dedupeAgainstHistoryImpl;

export type DedupeActivities = typeof dedupeActivities;

export const dedupeActivities = {
  async prReviewDedupe(input: DedupeInput): Promise<Finding[]> {
    return dedupeAgainstHistoryImpl(input);
  },
};

import {
  FlagsStaticUsageSchema,
  type FlagsUsageResponse,
} from "@shepherdjerred/feature-flags/flags-wire.ts";
import flagUsageJson from "./flag-usage.generated.json" with { type: "json" };
import type { FlagStore } from "./store.ts";

/**
 * Where each managed flag is read, from the committed index that
 * `bun run generate-flag-usage` writes and `bun run check-flag-usage` keeps
 * fresh in CI. Parsed strictly at load: a malformed index fails startup.
 */
const staticUsage = FlagsStaticUsageSchema.parse(flagUsageJson);

/**
 * Caps on what the tracker remembers. Callers record only deployments and
 * keys that exist in the store, so these are a backstop that keeps memory
 * bounded even if that changes: past the cap, new entries are dropped and
 * existing ones keep counting.
 */
export const MAX_TRACKED_DEPLOYMENTS = 256;
export const MAX_TRACKED_EVALUATIONS = 4096;

type FetchCounts = {
  lastFetchedAt: Date;
  fetches200: number;
  fetches304: number;
};

type EvaluationCounts = {
  readonly deployment: string;
  readonly key: string;
  lastEvaluatedAt: Date;
  count: number;
};

export type FlagsUsageTracker = {
  /** When this process started tracking; every counter is zero before it. */
  readonly since: Date;
  /** A consumer's snapshot read of a stored deployment: a 200 or a 304. */
  readonly recordFetch: (deployment: string, status: 200 | 304) => void;
  /** A `/v1/evaluate` answer for a stored deployment's live key. */
  readonly recordEvaluation: (deployment: string, key: string) => void;
  readonly fetches: (deployment: string) => Readonly<FetchCounts> | undefined;
  readonly evaluations: () => readonly Readonly<EvaluationCounts>[];
};

/**
 * In-memory liveness of consumer reads. It lives for one process, so a
 * Recreate release resets it; `since` says from when.
 */
export function createFlagsUsageTracker(
  now: () => Date = () => new Date(),
): FlagsUsageTracker {
  const fetches = new Map<string, FetchCounts>();
  const evaluations = new Map<string, EvaluationCounts>();
  return {
    since: now(),
    recordFetch(deployment, status) {
      let counts = fetches.get(deployment);
      if (counts === undefined) {
        if (fetches.size >= MAX_TRACKED_DEPLOYMENTS) return;
        counts = { lastFetchedAt: now(), fetches200: 0, fetches304: 0 };
        fetches.set(deployment, counts);
      }
      counts.lastFetchedAt = now();
      if (status === 200) counts.fetches200 += 1;
      else counts.fetches304 += 1;
    },
    recordEvaluation(deployment, key) {
      const id = JSON.stringify([deployment, key]);
      const existing = evaluations.get(id);
      if (existing !== undefined) {
        existing.lastEvaluatedAt = now();
        existing.count += 1;
        return;
      }
      if (evaluations.size >= MAX_TRACKED_EVALUATIONS) return;
      evaluations.set(id, {
        deployment,
        key,
        lastEvaluatedAt: now(),
        count: 1,
      });
    },
    fetches: (deployment) => fetches.get(deployment),
    evaluations: () => [...evaluations.values()],
  };
}

/** `GET /v1/usage`: every stored deployment's fetch liveness, plus the index. */
export function usageView(
  tracker: FlagsUsageTracker,
  store: FlagStore,
): FlagsUsageResponse {
  return {
    since: tracker.since.toISOString(),
    deployments: store.list().map(({ id }) => {
      const counts = tracker.fetches(id);
      return {
        id,
        lastFetchedAt: counts?.lastFetchedAt.toISOString() ?? null,
        fetches200: counts?.fetches200 ?? 0,
        fetches304: counts?.fetches304 ?? 0,
      };
    }),
    evaluations: tracker
      .evaluations()
      .map((entry) => ({
        deployment: entry.deployment,
        key: entry.key,
        lastEvaluatedAt: entry.lastEvaluatedAt.toISOString(),
        count: entry.count,
      }))
      .toSorted(
        (a, b) =>
          a.deployment.localeCompare(b.deployment) ||
          a.key.localeCompare(b.key),
      ),
    static: staticUsage,
  };
}

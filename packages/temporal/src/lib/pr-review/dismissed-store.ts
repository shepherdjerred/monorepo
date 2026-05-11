/**
 * Dismissed-comments KV abstraction over Bun.redis for the pr-review-bot
 * learning loop (Phase 9 of packages/docs/plans/2026-05-10_sota-pr-review-bot.md).
 *
 * # Key schema
 *
 * `pr-review:dismissed:{repo}:{path}:{kind}` → Redis List of JSON entries
 *
 * Where `{repo}` is `owner/name` and `{path}` is the file path relative to
 * repo root. Per-(repo, path, kind) scope means no cross-repo, no
 * cross-path, no cross-kind suppression. Listed as explicit negative
 * tests; widening this scope must be a deliberate, separate change.
 *
 * # Entry shape
 *
 * ```json
 * {
 *   "hash": "<sha256 of normalized claim>",
 *   "embedding": "<base64 of float32 array (1536 bytes for 384-d)>",
 *   "dismissedAt": "<ISO 8601>",
 *   "expiresAt": "<dismissedAt + 90d>",
 *   "reason": "thumbs-down" | "resolved-without-followup",
 *   "weight": 1.0 | 0.5,
 *   "evidence": { "commentId": <number>, "prNumber": <number>, "sha": "<commit sha>" }
 * }
 * ```
 *
 * # Capacity guarantees
 *
 * - List capped at 256 entries per key (LPUSH + LTRIM); oldest evicted.
 * - 90-day TTL applied via EXPIREAT on the key (refreshed on each
 *   ingestion); per-entry `expiresAt` filter at read time catches
 *   entries that pre-date the most recent ingestion's TTL refresh.
 * - Estimated steady state: a few thousand entries per repo across all
 *   (path, kind) combinations → ≤1 MB per repo.
 */
import { z } from "zod/v4";
import { EMBEDDING_DIM } from "#lib/pr-review/embedding.ts";
import { prReviewDedupeRedisErrorTotal } from "#observability/pr-review-metrics.ts";

/**
 * Minimal Redis surface used by the dedupe/listener modules. Bun.RedisClient
 * fits this interface structurally; tests pass a hand-rolled fake. The
 * activity-level contract is "command + args via send()", which keeps the
 * test mock small while letting Bun's real client through.
 */
export type RedisSend = {
  send: (cmd: string, args: string[]) => Promise<unknown>;
};

const KEY_PREFIX = "pr-review:dismissed";
const MAX_ENTRIES_PER_KEY = 256;
const FLOAT32_BYTES = 4;
const EXPECTED_EMBEDDING_BYTES = EMBEDDING_DIM * FLOAT32_BYTES;

export type DismissalReason = "thumbs-down" | "resolved-without-followup";

export const DismissalReasonSchema = z.enum([
  "thumbs-down",
  "resolved-without-followup",
]);

export const DismissedEntrySchema = z.object({
  hash: z.string().min(1),
  /** base64-encoded little-endian float32 array, length === EMBEDDING_DIM. */
  embedding: z.string().min(1),
  dismissedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  reason: DismissalReasonSchema,
  weight: z.number().positive(),
  evidence: z.object({
    commentId: z.number().int().nonnegative(),
    prNumber: z.number().int().positive(),
    sha: z.string().min(1),
  }),
});

export type DismissedEntry = z.infer<typeof DismissedEntrySchema>;

/**
 * Build the Redis key for a (repo, path, kind) triple. `owner/name`
 * preserves casing exactly as GitHub reports — kind is one of the
 * `FindingKind` enum values.
 */
export function dismissalKey(
  owner: string,
  repo: string,
  path: string,
  kind: string,
): string {
  return `${KEY_PREFIX}:${owner}/${repo}:${path}:${kind}`;
}

/**
 * Encode a float32 array as base64 little-endian bytes. Stable across
 * Voyage and the local fallback because both return 384-d arrays.
 */
export function encodeEmbedding(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIM) {
    throw new Error(
      `embedding dim ${vector.length.toString()} !== expected ${EMBEDDING_DIM.toString()}`,
    );
  }
  const buf = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    buf[i] = vector[i] ?? 0;
  }
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString(
    "base64",
  );
}

/**
 * Decode a base64 little-endian float32 array. Returns `null` on size
 * mismatch — calling code skips the entry rather than mixing dimensions.
 */
export function decodeEmbedding(encoded: string): readonly number[] | null {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== EXPECTED_EMBEDDING_BYTES) return null;
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, EMBEDDING_DIM);
  return [...view];
}

/**
 * Sum the weights of all entries whose vector exceeds `cosineThreshold`
 * similarity with `vector`. Mirrors the activity-level cumulative-weight
 * rule: total weight ≥ 1.0 across similar entries → drop.
 *
 * Returns the maximum cosine similarity observed (across only those
 * entries that exceeded the threshold) for surfacing in logs/metrics.
 */
export type SimilarityScan = {
  readonly cumulativeWeight: number;
  readonly bestSim: number;
  readonly matchedCount: number;
};

export type ScanSimilarityOptions = {
  readonly entries: readonly DismissedEntry[];
  readonly candidate: readonly number[];
  readonly cosineThreshold: number;
  readonly cosine: (a: readonly number[], b: readonly number[]) => number;
  readonly now?: Date;
};

export function scanSimilarity(opts: ScanSimilarityOptions): SimilarityScan {
  const { entries, candidate, cosineThreshold, cosine } = opts;
  const now = opts.now ?? new Date();
  let cumulativeWeight = 0;
  let bestSim = 0;
  let matchedCount = 0;
  for (const entry of entries) {
    if (new Date(entry.expiresAt).getTime() <= now.getTime()) continue;
    const vec = decodeEmbedding(entry.embedding);
    if (vec === null) continue;
    const sim = cosine(vec, candidate);
    if (sim > cosineThreshold) {
      cumulativeWeight += entry.weight;
      if (sim > bestSim) bestSim = sim;
      matchedCount += 1;
    }
  }
  return { cumulativeWeight, bestSim, matchedCount };
}

/**
 * Parse a list of raw JSON strings (as returned by `LRANGE`) into typed
 * entries, dropping malformed ones with a metric increment. Malformed
 * entries are rare (we wrote them; corruption indicates an out-of-band
 * write or a buggy older worker) but never fatal — better to lose
 * coverage on a few bad entries than crash the dedupe activity.
 */
export function parseEntries(raw: readonly string[]): DismissedEntry[] {
  const parsed: DismissedEntry[] = [];
  for (const r of raw) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(r);
    } catch {
      prReviewDedupeRedisErrorTotal.inc({ stage: "parse" });
      continue;
    }
    const result = DismissedEntrySchema.safeParse(candidate);
    if (!result.success) {
      prReviewDedupeRedisErrorTotal.inc({ stage: "parse" });
      continue;
    }
    parsed.push(result.data);
  }
  return parsed;
}

/**
 * Read all live entries for a key. Returns an empty list if the key
 * doesn't exist or Redis errors — callers fail-closed (no dedupe) on
 * those paths.
 */
export async function readEntries(
  redis: RedisSend,
  key: string,
): Promise<DismissedEntry[]> {
  try {
    // Bun.redis returns `string[]` for LRANGE. Defensive runtime
    // filtering to drop any non-string element rather than letting
    // JSON.parse fail downstream.
    const raw: unknown = await redis.send("LRANGE", [key, "0", "-1"]);
    if (!Array.isArray(raw)) return [];
    const stringEntries: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") stringEntries.push(item);
    }
    return parseEntries(stringEntries);
  } catch {
    prReviewDedupeRedisErrorTotal.inc({ stage: "query" });
    return [];
  }
}

/**
 * Append a new dismissal entry to its key, capping the list and
 * refreshing the TTL. Idempotency via `hash` is the CALLER's
 * responsibility (the reaction-listener activity skips entries whose
 * hash already appears for the key).
 */
export async function appendEntry(
  redis: RedisSend,
  key: string,
  entry: DismissedEntry,
  ttlSeconds: number,
): Promise<void> {
  const payload = JSON.stringify(entry);
  await redis.send("LPUSH", [key, payload]);
  await redis.send("LTRIM", [key, "0", String(MAX_ENTRIES_PER_KEY - 1)]);
  await redis.send("EXPIRE", [key, String(ttlSeconds)]);
}

/**
 * Returns true if any entry in the list shares the candidate hash. Used
 * for caller-side idempotency in the reaction-listener.
 */
export function entryAlreadyPresent(
  entries: readonly DismissedEntry[],
  hash: string,
): boolean {
  return entries.some((e) => e.hash === hash);
}

/**
 * Cluster-key utility shared between consensus voting (specialists) and the
 * eval grader. Both must use the same bucketing so fixture-graded precision
 * / recall lines up with what the bot actually clusters.
 *
 * # Bucketing
 *
 * Two findings cluster iff they share `clusterKey(file, lineStart)`. The
 * key is computed as `${file}|${floor(lineStart / 7) * 7}` — 7-line buckets
 * anchored on multiples of 7. This gives a worst-case tolerance of ±6 lines
 * (two findings near the edges of adjacent buckets) and a best-case
 * tolerance of ±3 lines (centered on a bucket).
 *
 * # Boundary caveat
 *
 * Bucketing on `floor(line / 7) * 7` does NOT guarantee strict ±3 tolerance:
 * a finding at line 6 and one at line 7 are in different buckets despite
 * being 1 line apart. We accept this for simplicity — the cost is occasional
 * false negatives at bucket boundaries, which empirically should be rare
 * relative to within-finding line shifts. If real fixtures show this drives
 * FN, swap the implementation to dual-key lookup without changing the
 * public API.
 *
 * # Why `kind` is NOT in the key
 *
 * Cross-specialist agreement is the load-bearing noise reducer per the SOTA
 * audit (Refute-or-Promote, Cursor BugBot v11). If `kind` were part of the
 * key, the security specialist (emits `kind: 'security'`) and the
 * correctness specialist (emits `kind: 'correctness'`) flagging the same
 * line would land in different clusters and the cross-specialist rule would
 * never fire. Instead, the cluster representative carries the most-severe
 * kind, and the post-review comment surfaces the set of kinds observed
 * ("security + correctness both flagged this line").
 *
 * # Field name
 *
 * Parameter name is `file` (matching `Finding.file`) rather than `path` so
 * `clusterFindings(findings)` can be passed a `Finding[]` directly without
 * a field-renaming step. Foundation renamed `Finding.path → Finding.file`
 * after this utility's first draft.
 *
 * # Doctest (worked examples)
 *
 * Given the canonical cluster key `${file}|${floor(lineStart / 7) * 7}`:
 *
 *   clusterKey("a.ts",  6) === "a.ts|0"   // bucket 0  (0..6)
 *   clusterKey("a.ts",  7) === "a.ts|7"   // bucket 7  (7..13)  ← different bucket from line 6
 *   clusterKey("a.ts", 10) === "a.ts|7"   // bucket 7  (7..13)
 *   clusterKey("a.ts", 13) === "a.ts|7"   // bucket 7  (7..13)
 *   clusterKey("a.ts", 14) === "a.ts|14"  // bucket 14 (14..20)
 *   clusterKey("b.ts",  7) === "b.ts|7"   // different file
 *
 *   clusterFindings([
 *     { file: "a.ts", lineStart: 10 },  // a.ts|7
 *     { file: "a.ts", lineStart: 12 },  // a.ts|7  (clusters with line 10)
 *     { file: "a.ts", lineStart: 13 },  // a.ts|7  (clusters with line 10)
 *     { file: "a.ts", lineStart: 14 },  // a.ts|14 (does NOT cluster — boundary)
 *     { file: "b.ts", lineStart: 12 },  // b.ts|7  (different file)
 *   ])
 *   // → Map {
 *   //     "a.ts|7"  => [{lineStart:10}, {lineStart:12}, {lineStart:13}],
 *   //     "a.ts|14" => [{lineStart:14}],
 *   //     "b.ts|7"  => [{lineStart:12}],
 *   //   }
 */

/** Width of each bucket. Findings within the same `floor(line / BUCKET_WIDTH) * BUCKET_WIDTH` bucket cluster. */
export const BUCKET_WIDTH = 7;

/**
 * Compute the cluster key for a finding identified by `(file, lineStart)`.
 *
 * Findings sharing the same return value cluster together. Use
 * `clusterFindings` for the common batch case.
 */
export function clusterKey(file: string, lineStart: number): string {
  const bucket = Math.floor(lineStart / BUCKET_WIDTH) * BUCKET_WIDTH;
  return `${file}|${String(bucket)}`;
}

/**
 * Group findings by their cluster key. Returns a Map preserving insertion
 * order so callers get stable iteration.
 *
 * Generic over any shape with `file` and `lineStart` fields so the eval
 * grader can pass its own fixture-finding shape without coercing to
 * `Finding`.
 */
export function clusterFindings<T extends { file: string; lineStart: number }>(
  findings: readonly T[],
): Map<string, T[]> {
  const clusters = new Map<string, T[]>();
  for (const finding of findings) {
    const key = clusterKey(finding.file, finding.lineStart);
    const existing = clusters.get(key);
    if (existing === undefined) {
      clusters.set(key, [finding]);
    } else {
      existing.push(finding);
    }
  }
  return clusters;
}

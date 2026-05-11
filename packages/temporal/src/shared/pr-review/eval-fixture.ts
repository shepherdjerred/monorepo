/**
 * Held-out fixture corpus loader + grader for the pr-review bot's
 * continuous-eval harness (Phase 10).
 *
 * Fixture metadata is stored in the sibling
 * `shepherdjerred/monorepo-pr-review-fixtures` repo (private). This module
 * defines the on-the-wire Zod schema for one fixture, plus a `grade()`
 * function that produces precision/recall against a set of bot-posted
 * findings.
 *
 * # Cluster-key contract
 *
 * Both grading and consensus voting use `clusterKey(path, lineStart)` from
 * `./cluster-key.ts` — the single source of truth. Do NOT reimplement
 * bucketing here. `kind` is intentionally not part of the cluster key (so
 * a security specialist and a correctness specialist flagging the same
 * line cluster together).
 *
 * # Real-bug fixtures (PR-shape)
 *
 * For `category: "real-bug"` fixtures the **inverted-fix diff** is what
 * the bot sees as the PR head — i.e., the diff from the fix commit back
 * to its parent. A perfect bot reviews "this PR removes the fix" and
 * surfaces the bug being re-introduced.
 *
 * # Hallucination-target fixtures
 *
 * Clean small changes where the bot must stay silent. `expectedFindings`
 * is empty (or contains at most 1 nit-severity comment). `forbiddenFindings`
 * captures plausible-but-wrong claims a hallucinating bot might emit.
 *
 * # Convention-drift fixtures
 *
 * Clean base PR with a single CLAUDE.md-rule violation injected. The bot
 * must catch the violation and cite the rule. One expected finding per
 * fixture.
 *
 * # Cross-file fixtures
 *
 * Rename / move PRs that intentionally OMIT the caller-side updates. The
 * bot must surface "caller X at file:line still references old name".
 */
import { z } from "zod/v4";
import { FindingSchema, type Finding } from "./finding.ts";
import { clusterKey, clusterFindings } from "./cluster-key.ts";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Forbidden-finding pattern: if the bot emits any finding whose `.claim`
 * matches one of these patterns, count it as a false positive (FP) even
 * if it doesn't cluster with an expected finding.
 *
 * Either `claimSubstring` or `claimRegex` is required. Optional `file`
 * restricts matching to findings on a specific file path.
 */
const PatternSchema = z
  .object({
    claimSubstring: z.string().optional(),
    claimRegex: z.string().optional(),
    file: z.string().optional(),
  })
  .refine(
    (p) => p.claimSubstring !== undefined || p.claimRegex !== undefined,
    "Pattern needs either claimSubstring or claimRegex",
  );

export type Pattern = z.infer<typeof PatternSchema>;

/**
 * Fixture metadata — one row of the held-out corpus.
 *
 * Fixture authors only declare the cluster identity (`file`, `lineStart`,
 * `lineEnd`, `kind`) plus the human-readable claim/severity/verifier. The
 * grader ignores `id`/`evidence`/`confidence`/`votes` when matching
 * expected ↔ posted findings.
 */
export const FixtureSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  category: z.enum([
    "real-bug",
    "hallucination-target",
    "refactor",
    "convention-drift",
    "cross-file",
  ]),
  source: z.object({
    repo: z.literal("shepherdjerred/monorepo"),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    parentSha: z.string().regex(/^[0-9a-f]{40}$/),
    prNumber: z.number().int().positive().optional(),
    subject: z.string().optional(),
  }),
  diffPath: z.literal("pr.diff"),
  snapshotRef: z.string().regex(/^snapshot\/[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  expectedFindings: z.array(
    FindingSchema.partial({
      id: true,
      evidence: true,
      confidence: true,
      votes: true,
    }).required({
      file: true,
      lineStart: true,
      lineEnd: true,
      kind: true,
      severity: true,
      verifier: true,
      claim: true,
    }),
  ),
  forbiddenFindings: z.array(PatternSchema),
  notes: z.string(),
  tolerances: z
    .object({
      /**
       * For refactor category: max permitted bot-posted comments before
       * counting the excess as FP. Default 1.
       */
      maxComments: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type Fixture = z.infer<typeof FixtureSchema>;
type ExpectedFinding = Fixture["expectedFindings"][number];

// ---------------------------------------------------------------------------
// Grader
// ---------------------------------------------------------------------------

export type GradeResult = {
  fixtureId: string;
  category: Fixture["category"];
  tp: number;
  fp: number;
  fn: number;
  /** tp / (tp + fp); 1 when no findings emitted */
  precision: number;
  /** tp / (tp + fn); 1 when no expected findings */
  recall: number;
  fpDetails: { claim: string; matchedPattern: string }[];
  fnDetails: { expected: ExpectedFinding }[];
  tpDetails: { expected: ExpectedFinding; matched: Finding }[];
};

function matchesPattern(finding: Finding, pattern: Pattern): boolean {
  if (pattern.file !== undefined && finding.file !== pattern.file) {
    return false;
  }
  if (pattern.claimSubstring !== undefined) {
    return finding.claim.includes(pattern.claimSubstring);
  }
  if (pattern.claimRegex !== undefined) {
    return new RegExp(pattern.claimRegex).test(finding.claim);
  }
  return false;
}

function describePattern(pattern: Pattern): string {
  if (pattern.claimSubstring !== undefined) {
    return `substring "${pattern.claimSubstring}"`;
  }
  if (pattern.claimRegex !== undefined) {
    return `regex /${pattern.claimRegex}/`;
  }
  // Refine clause guarantees one of the two is set; this branch is
  // unreachable but the type system can't prove that.
  return "(unspecified pattern)";
}

/**
 * Grade a set of bot-posted findings against a fixture. Clustering uses
 * the same `clusterKey(path, lineStart)` function as consensus voting, so
 * grader and bot stay aligned by construction.
 *
 * Behavior summary:
 *   - TP = expected finding whose cluster key matches a posted cluster.
 *   - FP = (a) a posted cluster on a forbidden-pattern claim (anywhere,
 *     even at an expected cluster — the bot landed the right line but
 *     said the wrong thing), OR (b) an unexpected cluster beyond the
 *     `maxComments` tolerance.
 *   - FN = expected finding with no matching posted cluster.
 *   - Per-fixture `tolerances.maxComments` overrides the "any unexpected
 *     counts" rule for refactor category — up to `maxComments` posted
 *     clusters can be non-expected without being counted as FP.
 *
 * A single posted cluster can produce BOTH a TP (cluster matches an
 * expected finding) AND an FP (its claim text matches a forbidden
 * pattern). That's the right semantics for "the bot found the right
 * place but said the wrong thing" — adversarial-robustness fixtures
 * rely on it.
 */
export function grade(fixture: Fixture, posted: Finding[]): GradeResult {
  // Keep the original Finding attached so we can surface the full claim
  // text and identity downstream. The `file` + `lineStart` fields satisfy
  // the `clusterFindings` generic constraint directly (since the Phase 3
  // rename, the cluster utility uses `file` to match `Finding.file`).
  const postedProjections = posted.map((f) => ({
    file: f.file,
    lineStart: f.lineStart,
    finding: f,
  }));
  const postedClusters = clusterFindings(postedProjections);

  const expectedByKey = new Map<string, ExpectedFinding>();
  for (const e of fixture.expectedFindings) {
    expectedByKey.set(clusterKey(e.file, e.lineStart), e);
  }

  const matchedExpectedKeys = new Set<string>();
  const tpDetails: GradeResult["tpDetails"] = [];
  const fpDetails: GradeResult["fpDetails"] = [];

  // Held for maxComments accounting — unexpected clusters that didn't
  // hit a forbidden pattern.
  type Unexpected = { representative: Finding };
  const unexpected: Unexpected[] = [];

  for (const [key, clusterMembers] of postedClusters) {
    const firstProjection = clusterMembers[0];
    if (firstProjection === undefined) continue;
    const representative = firstProjection.finding;

    // Forbidden-pattern check applies to every posted cluster, including
    // ones that match an expected finding's cluster. A bot that lands at
    // the right cluster but says e.g. "removing --force-with-lease is
    // safer" must be flagged — landing the cluster is necessary but not
    // sufficient.
    const forbidden = fixture.forbiddenFindings.find((p) =>
      matchesPattern(representative, p),
    );
    if (forbidden !== undefined) {
      fpDetails.push({
        claim: representative.claim,
        matchedPattern: describePattern(forbidden),
      });
    }

    const expected = expectedByKey.get(key);
    if (expected !== undefined) {
      matchedExpectedKeys.add(key);
      tpDetails.push({ expected, matched: representative });
      continue;
    }

    // Unexpected cluster, not forbidden-flagged → enter the maxComments
    // tolerance pool. If `forbidden !== undefined`, we already counted
    // it as FP above and don't re-count under maxComments.
    if (forbidden === undefined) {
      unexpected.push({ representative });
    }
  }

  // Apply maxComments tolerance — only the EXCESS over the tolerance counts
  // as FP. Refactor category default is 1; other categories default 0
  // (any unexpected finding is an FP).
  const defaultMaxComments = fixture.category === "refactor" ? 1 : 0;
  const maxComments = fixture.tolerances?.maxComments ?? defaultMaxComments;
  for (let i = maxComments; i < unexpected.length; i++) {
    const u = unexpected[i];
    if (u === undefined) continue;
    fpDetails.push({
      claim: u.representative.claim,
      matchedPattern: `unexpected finding beyond maxComments=${String(maxComments)}`,
    });
  }

  const fnDetails: GradeResult["fnDetails"] = [];
  for (const [key, expected] of expectedByKey) {
    if (!matchedExpectedKeys.has(key)) {
      fnDetails.push({ expected });
    }
  }

  const tp = tpDetails.length;
  const fp = fpDetails.length;
  const fn = fnDetails.length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

  return {
    fixtureId: fixture.id,
    category: fixture.category,
    tp,
    fp,
    fn,
    precision,
    recall,
    fpDetails,
    fnDetails,
    tpDetails,
  };
}

/**
 * Consensus voting activity.
 *
 * # What it does
 *
 * Takes the union of every finding emitted by every (specialist × pass) call
 * — typically 5 specialists × 3 passes = 15 LLM calls per PR — clusters
 * them by site, and keeps only findings supported by enough independent
 * votes to be worth posting.
 *
 * # Voting rule
 *
 * A cluster is kept iff EITHER:
 *   (a) ≥2 of N randomized passes within a single specialist produced it
 *       (within-specialist agreement), OR
 *   (b) ≥2 distinct specialist kinds produced it (cross-specialist agreement).
 *
 * Where N = `PASSES_PER_SPECIALIST` (currently 3, so ≥2/3 is the threshold).
 *
 * # Why the cluster key is kind-agnostic
 *
 * The cluster key is `clusterKey(path, lineStart) = ${path}|${floor(line/7)*7}`
 * — see `packages/temporal/src/shared/pr-review/cluster-key.ts`. The key
 * deliberately drops `kind` so the cross-specialist rule actually fires:
 * the security specialist (emits `kind: 'security'`) and the correctness
 * specialist (emits `kind: 'correctness'`) flagging the same line would
 * land in different clusters under a kind-strict key and the cross-spec
 * rule would never trigger. The cluster representative carries its own
 * kind (the most severe), and the post-review comment surfaces the
 * `kindsObserved` set so the comment can read "security + correctness
 * both flagged this line".
 *
 * Confirmed with team-lead before landing — see the PR description for
 * the design conversation.
 *
 * # Vote metadata on the kept finding
 *
 * The output `Finding[]` has its `votes` field populated:
 *   - `withinSpecialist`: max passes any single specialist hit
 *   - `withinSpecialistTotal`: N (the per-specialist pass count)
 *   - `acrossSpecialists`: distinct specialist kinds in the cluster
 *
 * Phase 1's `Finding` schema declared `votes` optional and unconstrained on
 * input — consensus is the activity that promises to populate it. PostReview
 * relies on it being present.
 *
 * # Opus 4.7 model swap from the plan
 *
 * The plan text says "Opus 4.7 specialists (24K thinking budget)". `budget_tokens`
 * is REMOVED on `claude-opus-4-7` (a 4.6-era field; sending it returns 400).
 * The current canonical depth knob is `thinking: { type: "adaptive" }` +
 * `output_config: { effort: "high" | "max" }`. The specialists implement
 * the plan's intent via effort tiers; the consensus activity itself doesn't
 * call the model at all.
 */

import { withSpan } from "#observability/tracing.ts";
import { prReviewConsensusFindingsTotal } from "#observability/metrics.ts";
import { clusterFindings } from "#shared/pr-review/cluster-key.ts";
import type {
  Finding,
  FindingKind,
  FindingSeverity,
} from "#shared/pr-review/finding.ts";
import { PASSES_PER_SPECIALIST } from "#lib/diff-slicing.ts";

const COMPONENT = "pr-review-pipeline";

/**
 * Severity ordering used to pick the cluster representative when multiple
 * findings cluster at the same site with different severities. Higher
 * value = more severe.
 */
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  nit: 0,
  warning: 1,
  critical: 2,
};

/**
 * One annotated finding entering the consensus activity. Every raw output
 * from a specialist pass is wrapped in this shape so the activity has the
 * provenance it needs to count votes (which pass produced it, from which
 * specialist).
 */
export type AnnotatedFinding = {
  finding: Finding;
  /** The specialist that produced this finding (e.g. `"correctness"`). */
  specialistId: string;
  /** The randomized-pass index (0..N-1). */
  passId: number;
};

export type ConsensusInput = {
  annotated: AnnotatedFinding[];
  /** Defaults to `PASSES_PER_SPECIALIST` (3). Allows tests to pass a smaller N. */
  passesPerSpecialist?: number;
};

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
      activity: "consensusVote",
      ...fields,
    }),
  );
}

/**
 * Pure implementation — no spans, no metrics, no I/O. Used by tests
 * directly. The Temporal activity wraps this with the span / metric emission.
 *
 * Algorithm:
 *   1. Cluster annotated findings by `clusterKey(path, lineStart)`.
 *   2. For each cluster, compute (max within-specialist passes, distinct
 *      specialists).
 *   3. Keep the cluster iff within-specialist ≥ ceil(2N/3) OR specialists ≥ 2.
 *   4. Pick the cluster representative: highest severity → highest
 *      confidence → lowest `id` for stability.
 *   5. Populate `votes` on the representative.
 */
export function voteOnFindings(input: ConsensusInput): Finding[] {
  const passesPerSpecialist =
    input.passesPerSpecialist ?? PASSES_PER_SPECIALIST;
  const withinThreshold = Math.ceil((passesPerSpecialist * 2) / 3);

  const clusters = clusterFindings(
    input.annotated.map((a) => ({
      // The cluster utility needs `file` and `lineStart` — pull them up so
      // each annotated finding is its own entry rather than nested.
      file: a.finding.file,
      lineStart: a.finding.lineStart,
      annotated: a,
    })),
  );

  const kept: Finding[] = [];

  for (const [key, members] of clusters) {
    // Build per-specialist pass sets and the set of distinct specialists.
    const passesBySpecialist = new Map<string, Set<number>>();
    const kindsObserved = new Set<FindingKind>();
    for (const m of members) {
      const a = m.annotated;
      let passes = passesBySpecialist.get(a.specialistId);
      if (passes === undefined) {
        passes = new Set<number>();
        passesBySpecialist.set(a.specialistId, passes);
      }
      passes.add(a.passId);
      kindsObserved.add(a.finding.kind);
    }
    const distinctSpecialists = passesBySpecialist.size;
    let maxWithinSpecialist = 0;
    for (const passes of passesBySpecialist.values()) {
      if (passes.size > maxWithinSpecialist) {
        maxWithinSpecialist = passes.size;
      }
    }

    const keptByWithin = maxWithinSpecialist >= withinThreshold;
    const keptByAcross = distinctSpecialists >= 2;
    if (!keptByWithin && !keptByAcross) {
      // dropped — fail the cluster
      for (const _m of members) {
        prReviewConsensusFindingsTotal.inc({ outcome: "dropped" });
      }
      continue;
    }

    // Pick a representative: highest severity → highest confidence →
    // lowest `id`. `toSorted` keeps the input array immutable.
    const sorted = members
      .map((m) => m.annotated.finding)
      .toSorted((a, b) => {
        const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
        if (sevDiff !== 0) return sevDiff;
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.id.localeCompare(b.id);
      });
    const rep = sorted[0];
    if (rep === undefined) {
      // unreachable: a cluster has at least one member by construction
      continue;
    }

    kept.push({
      ...rep,
      votes: {
        withinSpecialist: maxWithinSpecialist,
        withinSpecialistTotal: passesPerSpecialist,
        acrossSpecialists: distinctSpecialists,
      },
    });

    // Bookkeeping for the metric: each raw finding in the cluster counts
    // toward `kept`. One cluster of size 5 records 5 kept ticks because the
    // FPR / drop-rate alerts work at the finding level, not the cluster
    // level.
    for (const _m of members) {
      prReviewConsensusFindingsTotal.inc({ outcome: "kept" });
    }

    jsonLog("info", "cluster kept", {
      key,
      maxWithinSpecialist,
      distinctSpecialists,
      kindsObserved: [...kindsObserved],
      reasonWithin: keptByWithin,
      reasonAcross: keptByAcross,
    });
  }

  // Stable output ordering: by file then line. Helps tests + comment rendering.
  return kept.toSorted((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.lineStart - b.lineStart;
  });
}

async function consensusVoteImpl(input: ConsensusInput): Promise<Finding[]> {
  return await withSpan(
    "prReview.consensusVote",
    {
      "findings.input": input.annotated.length,
    },
    () => {
      const startedAt = input.annotated.length;
      const kept = voteOnFindings(input);
      jsonLog("info", "consensusVote completed", {
        inputCount: startedAt,
        outputCount: kept.length,
        droppedCount: startedAt - kept.length,
      });
      return Promise.resolve(kept);
    },
  );
}

export type ConsensusActivities = typeof consensusActivities;

export const consensusActivities = {
  async prReviewConsensus(input: ConsensusInput): Promise<Finding[]> {
    return consensusVoteImpl(input);
  },
};

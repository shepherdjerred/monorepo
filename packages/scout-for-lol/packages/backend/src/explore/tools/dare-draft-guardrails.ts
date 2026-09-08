/**
 * Drafting guardrails for Dare authoring.
 *
 * These are the checks the type system cannot make. A contract can be
 * structurally valid, reference only bound targets, and use only real lanes,
 * champions, and queues — and still be impossible to satisfy for semantic
 * reasons no schema can see. The historical preview is the only thing that
 * surfaces that, so it has to be run, and it has to say what it found.
 */

/** A per-turn record of which contracts have actually been previewed. */
export type DarePreviewLedger = {
  record: (canonicalScoutQl: string) => void;
  has: (canonicalScoutQl: string) => boolean;
};

/**
 * Keyed by canonical text rather than dare id: revising a contract must require
 * previewing it again rather than riding on an earlier version's result.
 */
export function createDarePreviewLedger(): DarePreviewLedger {
  const previewed = new Set<string>();
  return {
    record: (canonicalScoutQl) => {
      previewed.add(canonicalScoutQl);
    },
    has: (canonicalScoutQl) => previewed.has(canonicalScoutQl),
  };
}

export const DARE_PREVIEW_REQUIRED_ISSUE =
  "Call preview_dare_contract with this contract first. A contract can be valid and in-domain and still impossible to satisfy; the historical preview is what shows that, and it must be run against the exact contract being saved, whether that is a new draft or a revision.";

/**
 * Every path that persists a contract takes this gate, not just creation.
 *
 * Gating `create_dare_draft` alone left a complete bypass: preview and create
 * one contract, then revise it into an unpreviewed — and possibly impossible —
 * condition and fund that revision. A revision is funded exactly like a fresh
 * contract, so it has to be previewed exactly like one.
 *
 * `canonicalScoutQl` is null when the contract did not compile. That is not a
 * missing preview, and reporting one would bury the real reason under advice
 * the author cannot act on; the domain call that follows rejects it with its
 * own issues.
 */
export function dareContractNeedsPreview(
  ledger: DarePreviewLedger,
  canonicalScoutQl: string | null,
): boolean {
  return canonicalScoutQl !== null && !ledger.has(canonicalScoutQl);
}

/**
 * The shape of a historical preview this summary reads, kept structural so the
 * headline can be exercised without a lake.
 */
export type DarePreviewSummaryInput = {
  achieved: boolean | null;
  eligibleGames: number;
  coverageComplete: boolean;
  evidence: readonly { matchId: string; matched: boolean | null }[];
};

type MatchVerdict = "satisfied" | "unknown" | "unsatisfied";

/**
 * Evidence holds one row per (game set, match) while `eligibleGames` counts
 * DISTINCT matches, so counting rows against it could print "4 of 2 eligible
 * games satisfied this contract". Collapsing to a verdict per match is what
 * makes the ratio arithmetically possible.
 *
 * A satisfied game set wins over an unevaluable one, which wins over a plain
 * miss: `null` means the match's timeline coverage was incomplete, so its game
 * set is unknown rather than failed, and presenting it as a failure would
 * manufacture the very "impossible contract" signal this preview exists to
 * detect honestly.
 */
function verdictsByMatch(
  evidence: DarePreviewSummaryInput["evidence"],
): MatchVerdict[] {
  const verdicts = new Map<string, MatchVerdict>();
  for (const row of evidence) {
    const current = verdicts.get(row.matchId);
    if (current === "satisfied") continue;
    if (row.matched === true) {
      verdicts.set(row.matchId, "satisfied");
    } else if (row.matched === null) {
      verdicts.set(row.matchId, "unknown");
    } else if (current === undefined) {
      verdicts.set(row.matchId, "unsatisfied");
    }
  }
  return [...verdicts.values()];
}

/**
 * The root result, which is a different question from any single game set: a
 * contract can have game sets that fire in most games and still not be
 * achieved, and vice versa.
 */
function achievedSentence(achieved: boolean | null): string {
  if (achieved === true) {
    return "The contract itself evaluated to achieved over this window.";
  }
  if (achieved === false) {
    return "The contract itself evaluated to not achieved over this window.";
  }
  return "The contract itself could not be evaluated over this window.";
}

/**
 * The one line the author actually reads.
 *
 * This previously reported how many games were *considered*, so a predicate that
 * could never be satisfied read as reassuringly as a merely demanding one —
 * "Historically evaluated 12 eligible games" while every one of them failed. It
 * then reported raw matched evidence rows against distinct eligible matches,
 * which could print a ratio above one and counted an unevaluable game as a
 * failure. Lead with satisfied games per distinct match, say what coverage was
 * missing, and state the contract's own result separately.
 */
export function darePreviewSummary(preview: DarePreviewSummaryInput): string {
  if (preview.eligibleGames === 0) {
    return "No retained eligible games were found in the preview window, so this preview says nothing about whether the dare can be satisfied.";
  }
  const verdicts = verdictsByMatch(preview.evidence);
  const satisfied = verdicts.filter(
    (verdict) => verdict === "satisfied",
  ).length;
  const unknown = verdicts.filter((verdict) => verdict === "unknown").length;
  const eligible = preview.eligibleGames.toString();
  const sentences = [
    satisfied === 0
      ? `None of the ${eligible} distinct eligible games satisfied any game set of this contract.`
      : `${satisfied.toString()} of ${eligible} distinct eligible games satisfied at least one game set of this contract.`,
  ];
  if (unknown > 0) {
    sentences.push(
      `${unknown.toString()} of those games could not be evaluated because their timeline coverage is incomplete, so that count is a lower bound.`,
    );
  } else if (!preview.coverageComplete) {
    sentences.push(
      "Timeline coverage is incomplete for at least one eligible game, so that count is a lower bound.",
    );
  }
  sentences.push(achievedSentence(preview.achieved));
  if (satisfied === 0) {
    sentences.push(
      "Check the condition is achievable and spelled the way Riot records it before creating the dare.",
    );
  }
  return sentences.join(" ");
}

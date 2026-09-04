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
  "Call preview_dare_contract with this contract first. A contract can be valid and in-domain and still impossible to satisfy; the historical preview is what shows that, and it must be run against the contract being created.";

/**
 * The one line the author actually reads.
 *
 * This previously reported how many games were *considered*, so a predicate that
 * could never be satisfied read as reassuringly as a merely demanding one —
 * "Historically evaluated 12 eligible games" while every one of them failed.
 */
export function darePreviewSummary(
  eligibleGames: number,
  matched: number,
): string {
  if (eligibleGames === 0) {
    return "No retained eligible games were found in the preview window, so this preview says nothing about whether the dare can be satisfied.";
  }
  if (matched === 0) {
    return `0 of ${eligibleGames.toString()} eligible games satisfied this contract. Check the condition is achievable and spelled the way Riot records it before creating the dare.`;
  }
  return `${matched.toString()} of ${eligibleGames.toString()} eligible games satisfied this contract.`;
}

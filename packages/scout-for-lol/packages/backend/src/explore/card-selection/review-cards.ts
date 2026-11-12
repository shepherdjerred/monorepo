import { exploreLoadoutPairKey } from "#src/explore-match/loadout-view.ts";
import type { ReviewedMatch } from "#src/explore/analysis/review-tool.ts";
import type { ExploreCardSelection } from "./repair.ts";

/**
 * Card eligibility for one turn: the latest query's choices plus the reviewed
 * game, which the review read directly and no query may have returned.
 */
export function reviewEligibility(input: {
  lastMatchIds: ReadonlySet<string>;
  lastQueryLoadoutPairs: ReadonlySet<string>;
  reviewed: ReviewedMatch | null;
}): { eligibleMatchIds: Set<string>; eligibleLoadoutPairs: Set<string> } {
  const eligibleMatchIds = new Set(input.lastMatchIds);
  if (input.reviewed?.cardSupported === true)
    eligibleMatchIds.add(input.reviewed.matchId);
  const eligibleLoadoutPairs = new Set(input.lastQueryLoadoutPairs);
  if (input.reviewed !== null && input.reviewed.puuid !== null) {
    eligibleLoadoutPairs.add(
      exploreLoadoutPairKey({
        matchId: input.reviewed.matchId,
        puuid: input.reviewed.puuid,
      }),
    );
  }
  return { eligibleMatchIds, eligibleLoadoutPairs };
}

/**
 * Attach the reviewed game's cards deterministically, without relying on the
 * model requesting them. The reviewed match is the answer's central match, so
 * it takes `L` unless the model already used its one `L` (then `S`); a loadout
 * uses the default `S`. Caps and dedupe mirror the request schemas (max 5
 * match, max 3 loadout, one card per match / participant pair).
 */
export function withReviewCards(input: {
  selection: ExploreCardSelection;
  reviewed: ReviewedMatch | null;
}): ExploreCardSelection {
  const { selection, reviewed } = input;
  if (reviewed === null) return selection;
  let { matchCards, loadoutCards } = selection;
  if (
    reviewed.cardSupported &&
    matchCards.length < 5 &&
    !matchCards.some((card) => card.matchId === reviewed.matchId)
  ) {
    const size = matchCards.some((card) => card.size === "L") ? "S" : "L";
    matchCards = [...matchCards, { matchId: reviewed.matchId, size }];
  }
  if (
    reviewed.puuid !== null &&
    loadoutCards.length < 3 &&
    !loadoutCards.some(
      (card) =>
        card.matchId === reviewed.matchId && card.puuid === reviewed.puuid,
    )
  ) {
    loadoutCards = [
      ...loadoutCards,
      { matchId: reviewed.matchId, puuid: reviewed.puuid, size: "S" },
    ];
  }
  return matchCards === selection.matchCards &&
    loadoutCards === selection.loadoutCards
    ? selection
    : { matchCards, loadoutCards };
}

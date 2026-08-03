import type { EvalScore, HumanRating } from "#shared/schema.ts";

type RatingDimensions = Pick<
  HumanRating,
  "anchoredness" | "entertainment" | "styleRecognizability"
>;

export type RatingScoreSelection = {
  [Dimension in keyof RatingDimensions]: EvalScore | undefined;
};

export function aggregateRatingScore(
  selection: RatingScoreSelection,
): number | null {
  const { anchoredness, entertainment, styleRecognizability } = selection;
  if (
    anchoredness === undefined ||
    entertainment === undefined ||
    styleRecognizability === undefined
  ) {
    return null;
  }
  return (anchoredness + entertainment + styleRecognizability) / 3;
}

export function formatAggregateRatingScore(
  selection: RatingScoreSelection,
): string {
  const aggregate = aggregateRatingScore(selection);
  return aggregate === null
    ? "Select all three scores"
    : `${aggregate.toFixed(2)} / 3`;
}

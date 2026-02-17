import { match } from "https://esm.sh/ts-pattern@5.0.5";
import { z } from "https://esm.sh/zod@3.22.4";

export type RelativeRanking = z.infer<typeof RelativeRankingSchema>;
export const RelativeRankingSchema = z.string().brand("Ranking");

/**
 * In an ordered list, returns the ranking of the given index.
 * For example, 0 is 1st, 1 is 2nd, 2 is 3rd, etc.
 */
export function indexToRanking(index: number): RelativeRanking | undefined {
  const ranking = match(index)
    .with(0, () => "1st")
    .with(1, () => "2nd")
    .with(2, () => "3rd")
    .with(3, () => "4th")
    .with(4, () => "5th")
    .with(5, () => "6th")
    .with(6, () => "7th")
    .with(7, () => "8th")
    .with(8, () => "9th")
    .with(9, () => "10th")
    .otherwise(() => undefined);
  if (ranking) {
    return RelativeRankingSchema.parse(ranking);
  }
  return undefined;
}

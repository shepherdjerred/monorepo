import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { publicationFreshness } from "#infrastructure/native-compensation/publication-freshness.ts";

/** API command boundary only. Its existing command TX is fifteen seconds; this
 * original clock is captured before authentication, refresh or DB awaits and
 * never renewed by a household/queue helper or transaction retry. */
export function seriesPackNativeCommandInvocationV1() {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  return {
    observed,
    budget: new PublicationAuthorityReadBudget(),
    freshness: publicationFreshness(observed, observed.wall + 15_000),
  };
}
export type SeriesPackNativeCommandInvocationV1 = ReturnType<
  typeof seriesPackNativeCommandInvocationV1
>;

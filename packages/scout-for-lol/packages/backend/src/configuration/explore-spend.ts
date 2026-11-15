import { z } from "zod";

export const ExploreSpendPolicySchema = z.strictObject({
  globalMonthlyMicros: z.number().int().min(0).max(80_000_000),
  userMonthlyMicros: z.number().int().min(0).max(40_000_000),
  turnMicros: z.number().int().min(0).max(20_000_000),
});
export const DEFAULT_EXPLORE_SPEND_POLICY = {
  // One Ultrafast Sol call reserves a few dollars and then settles lower.
  // $10 lets a question make more than one call. $15 per person is several
  // of those. $40 shared stays well under the $200 monthly credit.
  globalMonthlyMicros: 40_000_000,
  userMonthlyMicros: 15_000_000,
  turnMicros: 10_000_000,
};

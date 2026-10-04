import { z } from "zod";

export const ExploreSpendPolicySchema = z.strictObject({
  globalMonthlyMicros: z.number().int().min(0).max(20_000_000),
  userMonthlyMicros: z.number().int().min(0).max(5_000_000),
  turnMicros: z.number().int().min(0).max(500_000),
});
export const DEFAULT_EXPLORE_SPEND_POLICY = {
  globalMonthlyMicros: 20_000_000,
  userMonthlyMicros: 5_000_000,
  turnMicros: 500_000,
};

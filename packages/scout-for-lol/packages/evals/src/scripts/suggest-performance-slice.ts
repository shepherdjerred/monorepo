import type { ExceptionalGameResult } from "@scout-for-lol/data";

export type SuggestedPerformanceSlice = "average" | "great" | "terrible";

export function suggestPerformanceSlice(
  exceptional: ExceptionalGameResult,
): SuggestedPerformanceSlice {
  if (!exceptional.isExceptional) return "average";
  if (exceptional.performancePolarity === "positive") return "great";
  if (exceptional.performancePolarity === "negative") return "terrible";
  return "average";
}

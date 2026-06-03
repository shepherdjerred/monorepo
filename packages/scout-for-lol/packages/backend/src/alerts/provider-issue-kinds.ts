// Sole purpose: hold `PROVIDER_ISSUE_KINDS` without importing the metrics
// counters, so `metrics/provider-issue-seeds.ts` can read it without closing
// the cycle `metrics/index.ts → provider-issue-seeds.ts → provider-metrics.ts
// → metrics/index.ts`. The cycle hit a TDZ `ReferenceError: Cannot access
// 'PROVIDER_ISSUE_KINDS' before initialization` in CI but not locally because
// Bun's module evaluation order differs between the two.
export const PROVIDER_ISSUE_KINDS = [
  "quota",
  "rate_limit",
  "budget_exceeded",
  "context_limit",
] as const;

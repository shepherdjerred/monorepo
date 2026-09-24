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

/**
 * Which provider a failure came from. Under the gateway every failure was
 * labelled "openrouter"; calling providers directly means the label can name
 * the one that actually refused. `unknown` is for a failure that carries no
 * request URL, which is honest where a guess from configuration would not be —
 * the model a call used can be changed at runtime through Flipt.
 *
 * Lives here rather than beside the recorder because the metric seeds import
 * it, and the recorder imports the metrics module: keeping it in this leaf
 * module is what avoids an initialization cycle.
 *
 * Historical series keep their old "openrouter" label in Prometheus; only new
 * emissions use these values.
 */
export const SCOUT_LLM_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "unknown",
] as const;

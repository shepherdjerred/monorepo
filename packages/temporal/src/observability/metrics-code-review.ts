import { Counter, Histogram } from "prom-client";
import { register } from "./metrics.ts";

// ---------------------------------------------------------------------------
// PR weighted round-robin code-review metrics (`ci/code-review`)
// ---------------------------------------------------------------------------
// Split out of metrics.ts (which sits at the repo's max-lines cap). Labels are
// strictly bounded enums (provider IDs, terminal results, bounded reasons) —
// never PR numbers or commit SHAs.

export const prCodeReviewAssignmentsTotal = new Counter({
  name: "pr_code_review_assignments_total",
  help: "PR code-review provider attempts reported by per-PR workflows, by provider",
  labelNames: ["provider"] as const,
  registers: [register],
});

export const prCodeReviewProviderOutcomesTotal = new Counter({
  name: "pr_code_review_provider_outcomes_total",
  help: "Per-provider PR code-review attempt outcomes reported to the coordinator, by provider and outcome (completed | skipped | usage-limited | timed-out)",
  labelNames: ["provider", "outcome"] as const,
  registers: [register],
});

export const prCodeReviewOutcomesTotal = new Counter({
  name: "pr_code_review_outcomes_total",
  help: "Terminal ci/code-review commit status outcomes, by result (success | failure) and bounded reason",
  labelNames: ["result", "reason"] as const,
  registers: [register],
});

export const prCodeReviewProviderCooldownsTotal = new Counter({
  name: "pr_code_review_provider_cooldowns_total",
  help: "Temporary provider cooldown windows entered by the code-review coordinator, by provider and reason",
  labelNames: ["provider", "reason"] as const,
  registers: [register],
});

export const prCodeReviewDurationSeconds = new Histogram({
  name: "pr_code_review_duration_seconds",
  help: "Wall-clock duration from PR code-review workflow start to terminal ci/code-review status, by result",
  labelNames: ["result"] as const,
  buckets: [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600],
  registers: [register],
});

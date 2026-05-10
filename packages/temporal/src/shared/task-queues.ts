export const TASK_QUEUES = {
  DEFAULT: "default",
  SCOUT: "scout",
  /**
   * Structured PR-review pipeline (multi-specialist consensus + empirical
   * verification). Separate queue from `DEFAULT` so the pipeline's slow,
   * LLM-bound activities don't head-of-line block the HA / cron workflows.
   * See packages/docs/plans/2026-05-10_sota-pr-review-bot.md.
   */
  PR_REVIEW: "pr-review",
  /**
   * SDK-native Haiku 4.5 PR summary pipeline (sibling to `prReviewPipeline`).
   * Separate queue from PR_REVIEW so a stuck specialist activity can't block
   * the cheap, fast summary path — operators still see "what changed in
   * this PR?" even when the deep review is degraded.
   */
  PR_SUMMARY: "pr-summary",
} as const;

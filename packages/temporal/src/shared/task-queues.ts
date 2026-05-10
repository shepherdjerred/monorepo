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
} as const;

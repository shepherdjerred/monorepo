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
  /**
   * Delayed and recurring report-only agent tasks. Kept off DEFAULT so
   * long-running Claude/Codex subprocesses do not block HA/event cron work.
   */
  AGENT_TASK: "agent-task",
  /**
   * Durable per-PR babysitter loops (the mutating "get this PR green" bot).
   * Isolated from every other queue so its long-lived loops + long mutating
   * `claude -p` subprocesses can't head-of-line block HA, cron, PR review, or
   * agent-task work. Sized for a small concurrency cap on the worker.
   */
  PR_BABYSIT: "pr-babysit",
} as const;

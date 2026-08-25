export const TASK_QUEUES = {
  DEFAULT: "default",
  /** Serial direct subprocess maintenance against the Buildkite PVCs. */
  MAINTENANCE: "maintenance",
  /** Scout beta activity worker, co-located with its database and Discord bot. */
  SCOUT_BETA: "scout-beta",
  /** Scout production activity worker, co-located with its database and Discord bot. */
  SCOUT_PROD: "scout-prod",
  /**
   * Delayed and recurring report-only agent tasks. Kept off DEFAULT so
   * long-running Claude/Codex SDK sessions do not block HA/event cron work.
   */
  AGENT_TASK: "agent-task",
  /**
   * Rate-limited Discord corpus capture. One activity at a time is a safety
   * invariant for the initial multi-year backfill and steady-state overlap.
   */
  GLITTER_CORPUS: "glitter-corpus",
  /**
   * Weekly GPT-5.6 Sol context generation is isolated from the latency-sensitive
   * Discord capture queue. One run at a time bounds clone, model, and disk use.
   */
  GLITTER_CONTEXT: "glitter-context",
} as const;

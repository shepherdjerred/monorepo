import type { TaskState } from "#src/domain/schemas.ts";

export function taskStatusView(state: TaskState) {
  return {
    issue: state.issue.identifier,
    phase: state.phase,
    lastAdvancedAt: state.updatedAt,
    waitsFor: {
      claiming: "Tracker claim",
      claimed: "checkout setup",
      implementing: "coding turn",
      publishing: "host verification and publication",
      awaiting_ci: "CI checks",
      awaiting_approval: "owner approval",
      merging: "merge confirmation",
      completing: "Tracker completion",
      needs_human: "Tracker update or owner input",
      blocked: "external blocker",
      passing: "pass recording and pull request closure",
      passed: "qualifying Tracker edit",
      done: null,
    }[state.phase],
    prNumber: state.prNumber,
    prUrl: state.prUrl,
    head: state.latestHeadSha,
    repairsUsed: state.repairTurnsUsed,
    passReason: state.lastPass?.reason ?? null,
    nextAttemptAt: state.nextAttemptAt,
  };
}

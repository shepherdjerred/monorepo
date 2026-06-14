// Public types shared between goal-manager and the goal-history helper.
// Lives in its own file so goal-history.ts doesn't pull goal-manager's
// runtime deps (Bun.spawn etc.) into modules that just want the types.

export type GoalStatus =
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "replaced"
  | "shutdown";

export type GoalState = {
  id: string;
  goal: string;
  requestedBy: string;
  channelId: string;
  startedAt: string;
  lockedUntil: string;
  deadline: string;
  status: GoalStatus;
  lastProgress?: string;
  finishedAt?: string;
  finalReport?: string;
  exitCode?: number;
};

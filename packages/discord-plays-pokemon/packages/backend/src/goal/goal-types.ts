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

export type GoalProcess = {
  pid?: number;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals | number) => void;
};

export type GoalProcessSpawner = (
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
  },
) => GoalProcess;

export type GoalDiscordMessage = {
  channelId: string;
  content: string;
  allowedUserIds?: string[];
};

export type GoalMessageSender = (message: GoalDiscordMessage) => Promise<void>;

export type StartGoalInput = {
  goal: string;
  requesterId: string;
  channelId: string;
};

export type StartGoalResult =
  | {
      kind: "started";
      content: string;
      ephemeral: false;
    }
  | {
      kind: "locked" | "disabled" | "invalid" | "missing_credential" | "busy";
      content: string;
      ephemeral: true;
    };

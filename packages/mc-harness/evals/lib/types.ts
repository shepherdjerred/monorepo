import type { DaemonClient } from "#evals/lib/daemon.ts";

export type GradeCheck = { name: string; pass: boolean; detail: string };

export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd?: number;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** What a task grader gets: the agent's leftovers and handles into its HOME. */
export type GradeContext = {
  taskId: string;
  /** Per-task directory under the run (artifacts go here). */
  taskDir: string;
  /** The OUT directory the agent was told to write to. */
  outDir: string;
  /** Isolated HOME the agent ran with (holds its daemon, journal, runs). */
  home: string;
  /** The disposable checkout the agent worked in. */
  worktree: string;
  /** Parsed `OUT/result.json`, or null when missing or not JSON. */
  result: Record<string, unknown> | null;
  daemon: DaemonClient;
  /** Runs `toolkit …` from the worktree with the agent's environment. */
  toolkit: (args: readonly string[]) => Promise<CommandResult>;
  /** Runs an arbitrary command from the worktree with the agent's environment. */
  exec: (argv: readonly string[]) => Promise<CommandResult>;
};

/** The pairwise judge's verdict on a build task, against a library reference. */
export type JudgeSummary = {
  reference: string;
  winner: "agent" | "reference" | "tie";
  confidence: number;
  agreed: boolean;
  model: string;
};

export type Grader = (ctx: GradeContext) => Promise<{
  checks: GradeCheck[];
  artifacts: string[];
  notes: string[];
  judge?: JudgeSummary | null;
}>;

export type TaskStatus = "passed" | "failed" | "timeout" | "error";

export type TaskReport = {
  id: string;
  title: string;
  status: TaskStatus;
  agentExitCode: number | null;
  seconds: number;
  usage: Usage | null;
  checks: GradeCheck[];
  artifacts: string[];
  notes: string[];
  judge: JudgeSummary | null;
  lastMessage: string;
  taskDir: string;
};

export type RunReport = {
  runId: string;
  startedAt: string;
  agent: string;
  model: string | null;
  head: string;
  tasks: TaskReport[];
};

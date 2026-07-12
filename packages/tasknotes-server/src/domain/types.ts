/**
 * Server-internal domain shapes.
 *
 * The `/api/*` contract lives in `tasknotes-types/v2` (snake_case, TaskInfo).
 * These are small server-side helper shapes: the NLP parser's output and the
 * ephemeral pomodoro status, neither of which is part of the wire contract.
 */

export type Priority =
  | "highest"
  | "high"
  | "medium"
  | "normal"
  | "low"
  | "none";

/** Output of `parseTaskInput` (src/nlp/parser.ts). */
export type NlpParseResult = {
  title: string;
  due?: string | undefined;
  priority?: Priority | undefined;
  projects?: string[] | undefined;
  contexts?: string[] | undefined;
  tags?: string[] | undefined;
  recurrence?: string | undefined;
};

/** Ephemeral pomodoro state (src/store/pomodoro-store.ts). */
export type PomodoroStatus = {
  active: boolean;
  taskId?: string | undefined;
  timeRemaining?: number | undefined;
  type?: ("work" | "break") | undefined;
};

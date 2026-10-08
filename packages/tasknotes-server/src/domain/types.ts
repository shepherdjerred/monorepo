/**
 * Server-internal domain shapes.
 *
 * The `/api/*` contract lives in `tasknotes-types/v2` (snake_case, TaskInfo).
 * This contains the server-side NLP parser's output.
 */

export type Priority =
  "highest" | "high" | "medium" | "normal" | "low" | "none";

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

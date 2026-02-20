import type { z } from "zod";
import type {
  BugsinkProjectSchema,
  BugsinkIssueSchema,
  BugsinkEventTagSchema,
  BugsinkStacktraceFrameSchema,
  BugsinkExceptionSchema,
  BugsinkEventUserSchema,
  BugsinkEventSchema,
} from "./schemas.ts";

export type BugsinkIssueStatus = "unresolved" | "resolved" | "muted";
export type BugsinkIssueLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";
export type BugsinkProject = z.infer<typeof BugsinkProjectSchema>;
export type BugsinkIssue = z.infer<typeof BugsinkIssueSchema>;
export type BugsinkEventTag = z.infer<typeof BugsinkEventTagSchema>;
export type BugsinkStacktraceFrame = z.infer<
  typeof BugsinkStacktraceFrameSchema
>;
export type BugsinkException = z.infer<typeof BugsinkExceptionSchema>;
export type BugsinkEventUser = z.infer<typeof BugsinkEventUserSchema>;
export type BugsinkEvent = z.infer<typeof BugsinkEventSchema>;

export type BugsinkPaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

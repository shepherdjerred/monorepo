import type { z } from "zod";
import type {
  BugsinkIssueSchema,
  BugsinkTeamSchema,
  BugsinkProjectDetailSchema,
  BugsinkEventListSchema,
  BugsinkEventDetailSchema,
  BugsinkReleaseListSchema,
  BugsinkReleaseDetailSchema,
} from "./schemas.ts";

export type BugsinkIssue = z.infer<typeof BugsinkIssueSchema>;
export type BugsinkTeam = z.infer<typeof BugsinkTeamSchema>;
export type BugsinkProjectDetail = z.infer<typeof BugsinkProjectDetailSchema>;
export type BugsinkEventListItem = z.infer<typeof BugsinkEventListSchema>;
export type BugsinkEventDetail = z.infer<typeof BugsinkEventDetailSchema>;
export type BugsinkReleaseListItem = z.infer<typeof BugsinkReleaseListSchema>;
export type BugsinkReleaseDetail = z.infer<typeof BugsinkReleaseDetailSchema>;

export type BugsinkPaginatedResponse<T> = {
  count?: number | undefined;
  next: string | null;
  previous: string | null;
  results: T[];
};

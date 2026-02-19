import { bugsinkRequest } from "./client.ts";
import {
  BugsinkIssueSchema,
  BugsinkEventSchema,
  BugsinkPaginatedResponseSchema,
} from "./schemas.ts";
import type { BugsinkIssue, BugsinkEvent } from "./types.ts";

export type GetIssuesOptions = {
  project?: string | undefined;
  limit?: number | undefined;
};

export async function getIssues(
  options: GetIssuesOptions = {},
): Promise<BugsinkIssue[]> {
  const params: Record<string, string> = {};

  if (options.project != null && options.project.length > 0) {
    params["project"] = options.project;
  }

  if (options.limit != null) {
    params["limit"] = String(options.limit);
  }

  const result = await bugsinkRequest(
    "/issues/",
    BugsinkPaginatedResponseSchema(BugsinkIssueSchema),
    params,
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch issues");
  }

  return result.data.results;
}

export async function getIssue(issueId: string): Promise<BugsinkIssue | null> {
  const result = await bugsinkRequest(
    `/issues/${issueId}/`,
    BugsinkIssueSchema,
  );

  if (!result.success) {
    if (result.error?.includes("404") === true) {
      return null;
    }
    throw new Error(result.error ?? "Failed to fetch issue");
  }

  return result.data ?? null;
}

export async function getIssueEvents(
  issueId: string,
  limit = 10,
): Promise<BugsinkEvent[]> {
  const result = await bugsinkRequest(
    `/issues/${issueId}/events/`,
    BugsinkPaginatedResponseSchema(BugsinkEventSchema),
    { limit: String(limit) },
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch issue events");
  }

  return result.data.results;
}

export async function getLatestEvent(
  issueId: string,
): Promise<BugsinkEvent | null> {
  const events = await getIssueEvents(issueId, 1);
  return events[0] ?? null;
}

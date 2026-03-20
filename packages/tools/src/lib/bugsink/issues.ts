import { bugsinkRequest } from "./client.ts";
import {
  BugsinkIssueSchema,
  BugsinkPaginatedResponseSchema,
} from "./schemas.ts";
import type { BugsinkIssue } from "./types.ts";

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

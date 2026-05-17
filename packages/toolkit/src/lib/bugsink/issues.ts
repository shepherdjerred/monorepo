import { bugsinkRequest } from "./client.ts";
import {
  BugsinkIssueSchema,
  BugsinkPaginatedResponseSchema,
} from "./schemas.ts";
import type { BugsinkIssue } from "./types.ts";
import { getProjects } from "./queries.ts";

export type GetIssuesOptions = {
  project?: string | undefined;
  limit?: number | undefined;
};

export async function getIssues(
  options: GetIssuesOptions = {},
): Promise<BugsinkIssue[]> {
  const params: Record<string, string> = {};

  if (options.project != null && options.project.length > 0) {
    params["project"] = await resolveProjectFilter(options.project);
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

async function resolveProjectFilter(project: string): Promise<string> {
  if (/^\d+$/.test(project)) {
    return project;
  }

  const projects = await getProjects();
  const match = projects.find((candidate) => candidate.slug === project);
  if (match === undefined) {
    throw new Error(`Bugsink project slug not found: ${project}`);
  }
  return String(match.id);
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

import {
  bugsinkPaginationOptionsError,
  bugsinkRequest,
  bugsinkRequestPaginated,
} from "./client.ts";
import { BugsinkIssueSchema } from "./schemas.ts";
import type { BugsinkIssue } from "./types.ts";
import { getProjects } from "./queries.ts";

export type GetIssuesOptions = {
  /** Project slug or numeric id. Omitted lists issues across every project. */
  project?: string | undefined;
  limit?: number | undefined;
  /** Page cap per project listing. */
  maxPages?: number | undefined;
  /** Include resolved and muted issues. Defaults to unresolved, unmuted only. */
  all?: boolean | undefined;
};

export function isOpenIssue(issue: BugsinkIssue): boolean {
  return !issue.is_resolved && !issue.is_muted;
}

/**
 * List issues. The canonical API requires a `project` on `/issues/`, so
 * without one this lists every project and reads each project's issues in
 * turn, stopping once `limit` issues are collected.
 */
export async function getIssues(
  options: GetIssuesOptions = {},
): Promise<BugsinkIssue[]> {
  const optionsError = bugsinkPaginationOptionsError(options);
  if (optionsError != null) {
    throw new Error(optionsError);
  }
  if (options.limit === 0) {
    return [];
  }

  const projectIds = await issueProjectIds(options);

  const issues: BugsinkIssue[] = [];
  for (const projectId of projectIds) {
    const remaining =
      options.limit === undefined ? undefined : options.limit - issues.length;
    if (remaining === 0) {
      break;
    }
    issues.push(
      ...(await getProjectIssues(projectId, {
        limit: remaining,
        maxPages: options.maxPages,
        all: options.all,
      })),
    );
  }
  return issues;
}

async function issueProjectIds(
  options: Pick<GetIssuesOptions, "project" | "maxPages">,
): Promise<string[]> {
  if (options.project != null && options.project.length > 0) {
    return [await resolveProjectFilter(options.project)];
  }
  const projects = await getProjects(undefined, {
    maxPages: options.maxPages,
  });
  return projects.map((project) => String(project.id));
}

async function getProjectIssues(
  projectId: string,
  options: Pick<GetIssuesOptions, "limit" | "maxPages" | "all">,
): Promise<BugsinkIssue[]> {
  const result = await bugsinkRequestPaginated(
    "/issues/",
    BugsinkIssueSchema,
    { project: projectId },
    {
      limit: options.limit,
      maxPages: options.maxPages,
      include: options.all === true ? undefined : isOpenIssue,
    },
  );

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "Failed to fetch issues");
  }

  return result.data;
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

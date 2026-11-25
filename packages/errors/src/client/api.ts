import { z } from "zod";
import {
  BulkUpdateIssuesResponseSchema,
  CreateTrackerIssueResponseSchema,
  EventDetailSchema,
  EventListResponseSchema,
  IssueDetailSchema,
  IssueListResponseSchema,
  OverviewResponseSchema,
  ProjectSummarySchema,
  ReleaseListResponseSchema,
  type BulkUpdateIssuesInput,
  type BulkUpdateIssuesResponse,
  type CreateProjectInput,
  type CreateTrackerIssueInput,
  type CreateTrackerIssueResponse,
  type EventDetail,
  type EventListResponse,
  type IssueDetail,
  type IssueFilterTab,
  type IssueListResponse,
  type IssueSort,
  type IssueState,
  type OverviewResponse,
  type ProjectSummary,
  type ReleaseListResponse,
  type SortOrder,
  type UpdateIssueStateInput,
  type UpdateProjectInput,
} from "#shared/contract.ts";

const ApiErrorPayloadSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});

const ProjectListResponseSchema = z.object({
  items: z.array(ProjectSummarySchema),
});

export class ErrorsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ErrorsApiError";
    this.status = status;
  }
}

async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const raw: unknown = await response.json();
    const parsed = ApiErrorPayloadSchema.safeParse(raw);
    if (parsed.success) {
      const candidate = parsed.data.error ?? parsed.data.message;
      if (candidate !== undefined && candidate.trim().length > 0) {
        return candidate;
      }
    }
  } catch {
    // Non-JSON responses fall back to the HTTP status summary below.
  }
  return `${fallback} (HTTP ${String(response.status)})`;
}

async function requestJson<Output>(options: {
  readonly path: string;
  readonly schema: z.ZodType<Output>;
  readonly fallbackError: string;
  readonly method?: "GET" | "POST" | "PATCH";
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
}): Promise<Output> {
  const { path, schema, fallbackError, method = "GET", body, signal } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new ErrorsApiError(
      await readErrorMessage(response, fallbackError),
      response.status,
    );
  }
  const payload: unknown = await response.json();
  return schema.parse(payload);
}

export type IssueListParams = {
  readonly project?: string | undefined;
  readonly tab?: IssueFilterTab | undefined;
  readonly state?: IssueState | undefined;
  readonly q?: string | undefined;
  readonly release?: string | undefined;
  readonly hasTrackerIssue?: "true" | "false" | undefined;
  readonly sort?: IssueSort | undefined;
  readonly order?: SortOrder | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

function buildIssueSearchParams(params: IssueListParams): URLSearchParams {
  const search = new URLSearchParams();
  const entries: readonly (readonly [string, string | undefined])[] = [
    ["project", params.project],
    ["tab", params.tab],
    ["state", params.state],
    ["q", params.q],
    ["release", params.release],
    ["hasTrackerIssue", params.hasTrackerIssue],
    ["sort", params.sort],
    ["order", params.order],
    ["cursor", params.cursor],
    ["limit", params.limit === undefined ? undefined : String(params.limit)],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value.trim().length > 0) {
      search.set(key, value.trim());
    }
  }
  return search;
}

export async function fetchOverview(
  signal?: AbortSignal,
): Promise<OverviewResponse> {
  return requestJson({
    path: "/api/v1/overview",
    schema: OverviewResponseSchema,
    fallbackError: "Unable to load error overview",
    signal,
  });
}

export async function fetchProjects(
  signal?: AbortSignal,
): Promise<readonly ProjectSummary[]> {
  const result = await requestJson({
    path: "/api/v1/projects",
    schema: ProjectListResponseSchema,
    fallbackError: "Unable to load projects",
    signal,
  });
  return result.items;
}

export async function fetchProject(
  idOrSlug: string | number,
  signal?: AbortSignal,
): Promise<ProjectSummary> {
  return requestJson({
    path: `/api/v1/projects/${encodeURIComponent(String(idOrSlug))}`,
    schema: ProjectSummarySchema,
    fallbackError: "Unable to load project",
    signal,
  });
}

export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectSummary> {
  return requestJson({
    path: "/api/v1/projects",
    method: "POST",
    body: input,
    schema: ProjectSummarySchema,
    fallbackError: "Unable to create project",
  });
}

export async function updateProject(
  idOrSlug: string | number,
  input: UpdateProjectInput,
): Promise<ProjectSummary> {
  return requestJson({
    path: `/api/v1/projects/${encodeURIComponent(String(idOrSlug))}`,
    method: "PATCH",
    body: input,
    schema: ProjectSummarySchema,
    fallbackError: "Unable to update project",
  });
}

export async function fetchIssues(
  params: IssueListParams,
  signal?: AbortSignal,
): Promise<IssueListResponse> {
  const query = buildIssueSearchParams(params).toString();
  return requestJson({
    path: query.length > 0 ? `/api/v1/issues?${query}` : "/api/v1/issues",
    schema: IssueListResponseSchema,
    fallbackError: "Unable to load issues",
    signal,
  });
}

export async function fetchIssueDetail(
  id: string,
  signal?: AbortSignal,
): Promise<IssueDetail> {
  return requestJson({
    path: `/api/v1/issues/${encodeURIComponent(id)}`,
    schema: IssueDetailSchema,
    fallbackError: "Unable to load issue detail",
    signal,
  });
}

export async function updateIssueState(
  id: string,
  input: UpdateIssueStateInput,
): Promise<IssueDetail> {
  return requestJson({
    path: `/api/v1/issues/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: input,
    schema: IssueDetailSchema,
    fallbackError: "Unable to update issue state",
  });
}

export async function bulkUpdateIssues(
  input: BulkUpdateIssuesInput,
): Promise<BulkUpdateIssuesResponse> {
  return requestJson({
    path: "/api/v1/issues/bulk-update",
    method: "POST",
    body: input,
    schema: BulkUpdateIssuesResponseSchema,
    fallbackError: "Unable to update selected issues",
  });
}

export async function createTrackerIssue(
  id: string,
  input: CreateTrackerIssueInput,
): Promise<CreateTrackerIssueResponse> {
  return requestJson({
    path: `/api/v1/issues/${encodeURIComponent(id)}/tracker-issue`,
    method: "POST",
    body: input,
    schema: CreateTrackerIssueResponseSchema,
    fallbackError: "Unable to create Tracker AI issue",
  });
}

export async function fetchIssueEvents(
  issueId: string,
  options?: {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  },
  signal?: AbortSignal,
): Promise<EventListResponse> {
  const search = new URLSearchParams();
  if (options?.cursor !== undefined && options.cursor.length > 0) {
    search.set("cursor", options.cursor);
  }
  if (options?.limit !== undefined) {
    search.set("limit", String(options.limit));
  }
  const suffix = search.toString();
  const base = `/api/v1/issues/${encodeURIComponent(issueId)}/events`;
  return requestJson({
    path: suffix.length > 0 ? `${base}?${suffix}` : base,
    schema: EventListResponseSchema,
    fallbackError: "Unable to load issue events",
    signal,
  });
}

export async function fetchEventDetail(
  eventId: string,
  signal?: AbortSignal,
): Promise<EventDetail> {
  return requestJson({
    path: `/api/v1/events/${encodeURIComponent(eventId)}`,
    schema: EventDetailSchema,
    fallbackError: "Unable to load event detail",
    signal,
  });
}

export async function fetchReleases(
  project?: string,
  signal?: AbortSignal,
): Promise<ReleaseListResponse> {
  const search = new URLSearchParams();
  if (project !== undefined && project.trim().length > 0) {
    search.set("project", project.trim());
  }
  const suffix = search.toString();
  return requestJson({
    path: suffix.length > 0 ? `/api/v1/releases?${suffix}` : "/api/v1/releases",
    schema: ReleaseListResponseSchema,
    fallbackError: "Unable to load releases",
    signal,
  });
}

export const queryKeys = {
  overview: ["overview"] as const,
  projects: ["projects"] as const,
  project: (idOrSlug: string) => ["project", idOrSlug] as const,
  issuesRoot: ["issues"] as const,
  issues: (params: IssueListParams) => ["issues", params] as const,
  issue: (id: string) => ["issue", id] as const,
  issueEvents: (id: string) => ["issue-events", id] as const,
  event: (id: string) => ["event", id] as const,
  releases: (project: string) => ["releases", project] as const,
};

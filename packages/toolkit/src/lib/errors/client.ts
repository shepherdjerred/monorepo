import {
  BulkUpdateIssuesResponseSchema,
  BugsinkImportResultSchema,
  CreateTrackerIssueResponseSchema,
  EventDetailSchema,
  EventListResponseSchema,
  IssueDetailSchema,
  IssueListResponseSchema,
  OverviewResponseSchema,
  ReleaseListResponseSchema,
  type BulkUpdateIssuesResponse,
  type BugsinkImportResult,
  type CreateTrackerIssueResponse,
  type EventDetail,
  type EventListItem,
  type IssueDetail,
  type IssueFilterTab,
  type IssueListItem,
  type IssueState,
  type OverviewResponse,
  type ProjectSummary,
  type ReleaseItem,
  type TrackerTriageEffort,
  type TrackerTriageImpact,
  type TrackerTriageUrgency,
} from "@shepherdjerred/errors/contract";
import {
  collectCursorPages,
  errorsGetJson,
  errorsGetText,
  errorsSendJson,
  type ErrorsRequestOptions,
} from "./http.ts";
import {
  ProjectListResponseSchema,
  ProjectResponseSchema,
  SingleIssueUpdateResponseSchema,
  StacktraceJsonResponseSchema,
} from "./schemas.ts";

export async function getOverview(
  options?: ErrorsRequestOptions,
): Promise<OverviewResponse> {
  return errorsGetJson("/overview", OverviewResponseSchema, undefined, options);
}

export async function getProjects(
  options?: ErrorsRequestOptions,
): Promise<ProjectSummary[]> {
  return errorsGetJson(
    "/projects",
    ProjectListResponseSchema,
    undefined,
    options,
  );
}

export async function getProject(
  idOrSlug: string,
  options?: ErrorsRequestOptions,
): Promise<ProjectSummary> {
  return errorsGetJson(
    `/projects/${encodeURIComponent(idOrSlug)}`,
    ProjectResponseSchema,
    undefined,
    options,
  );
}

export type ErrorsIssuesQuery = {
  readonly project?: string | undefined;
  readonly tab?: IssueFilterTab | undefined;
  readonly state?: IssueState | undefined;
  readonly q?: string | undefined;
  readonly limit?: number | undefined;
  readonly all?: boolean | undefined;
  readonly maxPages?: number | undefined;
};

export async function getIssues(
  query: ErrorsIssuesQuery = {},
  options?: ErrorsRequestOptions,
): Promise<IssueListItem[]> {
  const baseQuery: Record<string, string> = {};
  if (query.project !== undefined && query.project.length > 0) {
    baseQuery["project"] = query.project;
  }
  if (query.tab !== undefined) {
    baseQuery["tab"] = query.tab;
  }
  if (query.state !== undefined) {
    baseQuery["state"] = query.state;
  }
  if (query.q !== undefined && query.q.length > 0) {
    baseQuery["q"] = query.q;
  }
  return collectCursorPages({
    endpoint: "/issues",
    pageSchema: IssueListResponseSchema,
    baseQuery,
    followCursors: query.all === true || query.limit !== undefined,
    limit: query.limit,
    maxPages: query.maxPages,
    options,
  });
}

export async function getIssue(
  id: string,
  options?: ErrorsRequestOptions,
): Promise<IssueDetail> {
  return errorsGetJson(
    `/issues/${encodeURIComponent(id)}`,
    IssueDetailSchema,
    undefined,
    options,
  );
}

export async function getIssueEvents(
  issueId: string,
  query: {
    readonly limit?: number | undefined;
    readonly maxPages?: number | undefined;
  } = {},
  options?: ErrorsRequestOptions,
): Promise<EventListItem[]> {
  return collectCursorPages({
    endpoint: `/issues/${encodeURIComponent(issueId)}/events`,
    pageSchema: EventListResponseSchema,
    baseQuery: {},
    followCursors: query.limit !== undefined,
    limit: query.limit,
    maxPages: query.maxPages,
    options,
  });
}

export async function getEvent(
  eventId: string,
  options?: ErrorsRequestOptions,
): Promise<EventDetail> {
  return errorsGetJson(
    `/events/${encodeURIComponent(eventId)}`,
    EventDetailSchema,
    undefined,
    options,
  );
}

export async function getEventStacktrace(
  eventId: string,
  options?: ErrorsRequestOptions,
): Promise<string> {
  return errorsGetText(
    `/events/${encodeURIComponent(eventId)}/stacktrace`,
    undefined,
    options,
  );
}

export async function getEventStacktraceJson(
  eventId: string,
  options?: ErrorsRequestOptions,
): Promise<Record<string, unknown>> {
  return errorsGetJson(
    `/events/${encodeURIComponent(eventId)}/stacktrace`,
    StacktraceJsonResponseSchema,
    { format: "json" },
    options,
  );
}

export async function getReleases(
  project?: string,
  options?: ErrorsRequestOptions,
): Promise<ReleaseItem[]> {
  const query =
    project !== undefined && project.length > 0 ? { project } : undefined;
  const response = await errorsGetJson(
    "/releases",
    ReleaseListResponseSchema,
    query,
    options,
  );
  return response.items;
}

export type UpdateIssuesStateArgs = {
  readonly ids: readonly string[];
  readonly state: IssueState;
  readonly resolvedInRelease?: string | undefined;
};

export async function updateIssuesState(
  args: UpdateIssuesStateArgs,
  options?: ErrorsRequestOptions,
): Promise<BulkUpdateIssuesResponse> {
  const { ids, state, resolvedInRelease } = args;
  const singleId = ids[0];
  if (singleId === undefined) {
    throw new Error("At least one issue UUID is required");
  }
  const releaseField =
    resolvedInRelease !== undefined && resolvedInRelease.length > 0
      ? { resolvedInRelease }
      : {};
  if (ids.length === 1) {
    const updated = await errorsSendJson({
      method: "PATCH",
      endpoint: `/issues/${encodeURIComponent(singleId)}`,
      body: { state, ...releaseField },
      schema: SingleIssueUpdateResponseSchema,
      options,
    });
    return { updatedCount: 1, items: [updated] };
  }
  return errorsSendJson({
    method: "POST",
    endpoint: "/issues/bulk-update",
    body: { ids: [...ids], state, ...releaseField },
    schema: BulkUpdateIssuesResponseSchema,
    options,
  });
}

export type CreateTrackerIssueArgs = {
  readonly title?: string | undefined;
  readonly urgency?: TrackerTriageUrgency | undefined;
  readonly impact?: TrackerTriageImpact | undefined;
  readonly effort?: TrackerTriageEffort | undefined;
};

export async function createTrackerIssue(
  issueId: string,
  args: CreateTrackerIssueArgs = {},
  options?: ErrorsRequestOptions,
): Promise<CreateTrackerIssueResponse> {
  const payload: Record<string, unknown> = {};
  if (args.title !== undefined && args.title.length > 0) {
    payload["title"] = args.title;
  }
  if (args.urgency !== undefined) {
    payload["urgency"] = args.urgency;
  }
  if (args.impact !== undefined) {
    payload["impact"] = args.impact;
  }
  if (args.effort !== undefined) {
    payload["effort"] = args.effort;
  }
  return errorsSendJson({
    method: "POST",
    endpoint: `/issues/${encodeURIComponent(issueId)}/tracker-issue`,
    body: payload,
    schema: CreateTrackerIssueResponseSchema,
    options,
  });
}

export type ImportBugsinkArgs = {
  readonly baseUrl?: string | undefined;
  readonly projectId?: number | undefined;
  readonly concurrency?: number | undefined;
  readonly dryRun?: boolean | undefined;
};

export async function importBugsink(
  args: ImportBugsinkArgs = {},
  options?: ErrorsRequestOptions,
): Promise<BugsinkImportResult> {
  const payload: Record<string, unknown> = {
    dryRun: args.dryRun === true,
  };
  if (args.baseUrl !== undefined && args.baseUrl.length > 0) {
    payload["baseUrl"] = args.baseUrl;
  }
  if (args.projectId !== undefined) {
    payload["projectId"] = args.projectId;
  }
  if (args.concurrency !== undefined) {
    payload["concurrency"] = args.concurrency;
  }
  return errorsSendJson({
    method: "POST",
    endpoint: "/admin/import-bugsink",
    body: payload,
    schema: BugsinkImportResultSchema,
    options,
  });
}

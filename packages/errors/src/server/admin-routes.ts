import type { Context, Hono } from "hono";
import { z } from "zod";
import {
  runBugsinkImport,
  type FetchLike,
} from "#infrastructure/bugsink-importer.ts";
import { constantTimeStringEquals } from "#infrastructure/repository-helpers.ts";
import type { ErrorsRepository } from "#infrastructure/repository-types.ts";
import type { TrackerIssueClient } from "#infrastructure/tracker-client.ts";
import {
  BugsinkImportRequestSchema,
  BulkUpdateIssuesInputSchema,
  CreateProjectInputSchema,
  CreateReleaseInputSchema,
  CreateTrackerIssueInputSchema,
  DEFAULT_TAILNET_CONSOLE_URL,
  IssueListQuerySchema,
  UpdateIssueStateInputSchema,
  UpdateProjectInputSchema,
  type Viewer,
} from "#shared/contract.ts";

const EventListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AdminApiRouteDeps = {
  readonly repo: ErrorsRepository;
  readonly trackerClient: TrackerIssueClient | null;
  readonly trackerCreationEnabled: () => Promise<boolean>;
  readonly machineToken?: string | undefined;
  readonly consolePublicOrigin?: string | undefined;
  readonly bugsinkImportUrl?: string | undefined;
  readonly bugsinkImportToken?: string | undefined;
  readonly bugsinkFetchFn?: FetchLike | undefined;
};

export function headerOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractViewer(c: Context): Viewer {
  return {
    login: headerOrNull(c.req.header("Tailscale-User-Login")),
    displayName: headerOrNull(c.req.header("Tailscale-User-Name")),
  };
}

function isAuthorizedMutation(
  c: Context,
  machineToken: string | undefined,
): boolean {
  if (machineToken === undefined) {
    return true;
  }
  const tailscaleLogin = headerOrNull(c.req.header("Tailscale-User-Login"));
  if (tailscaleLogin !== null) {
    return true;
  }
  const authHeader = c.req.header("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const provided = authHeader.slice("Bearer ".length).trim();
    return (
      provided.length > 0 && constantTimeStringEquals(provided, machineToken)
    );
  }
  return false;
}

async function parseJsonBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly response: Response }
> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: "Request body must be valid JSON." }, 400),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return {
      ok: false,
      response: c.json(
        { error: message.length > 0 ? message : "Invalid request payload." },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

function buildTrackerDescription(options: {
  readonly projectName: string;
  readonly projectSlug: string;
  readonly issueId: string;
  readonly type: string;
  readonly value: string;
  readonly transaction: string;
  readonly digestedEventCount: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly stacktraceMd: string;
  readonly consoleOrigin: string;
}): string {
  const issueUrl = `${options.consoleOrigin.replace(/\/+$/u, "")}/issues/${options.issueId}`;
  const headerLines = [
    `Error issue in **${options.projectName}** (\`${options.projectSlug}\`): [open in Errors console](${issueUrl})`,
    "",
    `- **Exception:** \`${options.type}\`: ${options.value}`,
    `- **Events:** ${String(options.digestedEventCount)} (first seen ${options.firstSeen}, last seen ${options.lastSeen})`,
  ];
  if (options.transaction.length > 0) {
    headerLines.push(`- **Transaction:** \`${options.transaction}\``);
  }
  if (options.stacktraceMd.trim().length > 0) {
    headerLines.push("", "---", "", options.stacktraceMd.trim());
  }
  return headerLines.join("\n");
}

export function registerAdminApiRoutes(
  app: Hono,
  deps: AdminApiRouteDeps,
): void {
  const consoleOrigin = deps.consolePublicOrigin ?? DEFAULT_TAILNET_CONSOLE_URL;

  app.get("/api/v1/overview", async (c) => {
    const overview = await deps.repo.getOverview(extractViewer(c));
    return c.json(overview, 200);
  });

  app.get("/api/v1/ops-summary", async (c) => {
    const summary = await deps.repo.getOpsSummary();
    return c.json(summary, 200);
  });

  app.get("/api/v1/projects", async (c) => {
    const items = await deps.repo.listProjects();
    return c.json({ items }, 200);
  });

  app.get("/api/v1/projects/:idOrSlug", async (c) => {
    const project = await deps.repo.getProject(c.req.param("idOrSlug"));
    return project === null
      ? c.json({ error: "Project not found." }, 404)
      : c.json(project, 200);
  });

  app.post("/api/v1/projects", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, CreateProjectInputSchema);
    if (!body.ok) {
      return body.response;
    }
    const created = await deps.repo.createProject(body.data);
    return c.json(created, 201);
  });

  app.patch("/api/v1/projects/:idOrSlug", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, UpdateProjectInputSchema);
    if (!body.ok) {
      return body.response;
    }
    const updated = await deps.repo.updateProject(
      c.req.param("idOrSlug"),
      body.data,
    );
    return updated === null
      ? c.json({ error: "Project not found." }, 404)
      : c.json(updated, 200);
  });

  app.get("/api/v1/issues", async (c) => {
    const parsedQuery = IssueListQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json({ error: "Invalid issue query parameters." }, 400);
    }
    const response = await deps.repo.listIssues(parsedQuery.data);
    return c.json(response, 200);
  });

  app.post("/api/v1/issues/bulk-update", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, BulkUpdateIssuesInputSchema);
    if (!body.ok) {
      return body.response;
    }
    const result = await deps.repo.bulkUpdateIssues(body.data);
    return c.json(result, 200);
  });

  app.get("/api/v1/issues/:id", async (c) => {
    const detail = await deps.repo.getIssue(c.req.param("id"));
    return detail === null
      ? c.json({ error: "Issue not found." }, 404)
      : c.json(detail, 200);
  });

  app.patch("/api/v1/issues/:id", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, UpdateIssueStateInputSchema);
    if (!body.ok) {
      return body.response;
    }
    const issueId = c.req.param("id");
    const result = await deps.repo.updateIssueState(issueId, body.data);
    if (result.status === "not_found") {
      return c.json({ error: "Issue not found." }, 404);
    }
    if (result.status === "conflict") {
      return c.json(
        { error: "Issue revision conflict.", current: result.current },
        409,
      );
    }
    const detail = await deps.repo.getIssue(issueId);
    return detail === null
      ? c.json({ error: "Issue not found." }, 404)
      : c.json(detail, 200);
  });

  app.post("/api/v1/issues/:id/tracker-issue", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!(await deps.trackerCreationEnabled())) {
      return c.json(
        { error: "Tracker issue creation is currently disabled." },
        403,
      );
    }
    if (deps.trackerClient === null) {
      return c.json({ error: "Tracker client is not configured." }, 503);
    }

    let rawBody: unknown = {};
    const contentLength = c.req.header("Content-Length");
    if (contentLength !== "0") {
      try {
        rawBody = await c.req.json();
      } catch {
        rawBody = {};
      }
    }
    const parsedBody = CreateTrackerIssueInputSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json({ error: "Invalid Tracker issue request." }, 400);
    }

    const issueId = c.req.param("id");
    const existingDetail = await deps.repo.getIssue(issueId);
    if (existingDetail === null) {
      return c.json({ error: "Issue not found." }, 404);
    }

    if (existingDetail.trackerIssueIdentifier !== null) {
      const {
        fingerprints: _f,
        latestEvent: _e,
        ...issueItem
      } = existingDetail;
      return c.json(
        {
          trackerIssueIdentifier: existingDetail.trackerIssueIdentifier,
          trackerUrl: deps.trackerClient.issueUrlForIdentifier(
            existingDetail.trackerIssueIdentifier,
          ),
          created: false,
          issue: issueItem,
        },
        200,
      );
    }

    const defaultTitle =
      `${existingDetail.projectName}: ${existingDetail.type}: ${existingDetail.value}`.slice(
        0,
        280,
      );
    const createdTracker = await deps.trackerClient.createIssue({
      title: parsedBody.data.title ?? defaultTitle,
      description: buildTrackerDescription({
        projectName: existingDetail.projectName,
        projectSlug: existingDetail.projectSlug,
        issueId: existingDetail.id,
        type: existingDetail.type,
        value: existingDetail.value,
        transaction: existingDetail.transaction,
        digestedEventCount: existingDetail.digestedEventCount,
        firstSeen: existingDetail.firstSeen,
        lastSeen: existingDetail.lastSeen,
        stacktraceMd: existingDetail.latestEvent?.stacktraceMd ?? "",
        consoleOrigin,
      }),
      urgency: parsedBody.data.urgency,
      impact: parsedBody.data.impact,
      effort: parsedBody.data.effort,
    });

    const updatedIssue = await deps.repo.setTrackerIssue(
      existingDetail.id,
      createdTracker.identifier,
    );
    if (updatedIssue === null) {
      return c.json({ error: "Issue not found." }, 404);
    }

    return c.json(
      {
        trackerIssueIdentifier: createdTracker.identifier,
        trackerUrl: createdTracker.url,
        created: true,
        issue: updatedIssue,
      },
      201,
    );
  });

  app.get("/api/v1/issues/:id/events", async (c) => {
    const parsedQuery = EventListQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json({ error: "Invalid event pagination parameters." }, 400);
    }
    const events = await deps.repo.listEvents(
      c.req.param("id"),
      parsedQuery.data,
    );
    return events === null
      ? c.json({ error: "Issue not found." }, 404)
      : c.json(events, 200);
  });

  app.get("/api/v1/events/:id", async (c) => {
    const detail = await deps.repo.getEvent(c.req.param("id"));
    return detail === null
      ? c.json({ error: "Event not found." }, 404)
      : c.json(detail, 200);
  });

  app.get("/api/v1/events/:id/stacktrace", async (c) => {
    const detail = await deps.repo.getEvent(c.req.param("id"));
    if (detail === null) {
      return c.json({ error: "Event not found." }, 404);
    }
    const formatQuery = c.req.query("format")?.trim().toLowerCase();
    const acceptHeader = (c.req.header("Accept") ?? "").toLowerCase();
    if (
      formatQuery === "json" ||
      (formatQuery !== "markdown" && acceptHeader.includes("application/json"))
    ) {
      return c.json(
        {
          id: detail.id,
          eventId: detail.eventId,
          issueId: detail.issueId,
          stacktraceMd: detail.stacktraceMd,
        },
        200,
      );
    }
    return c.body(detail.stacktraceMd, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });

  app.get("/api/v1/releases", async (c) => {
    const projectFilter = c.req.query("project")?.trim();
    const releases = await deps.repo.listReleases(
      projectFilter !== undefined && projectFilter.length > 0
        ? projectFilter
        : undefined,
    );
    return c.json(releases, 200);
  });

  app.post("/api/v1/releases", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, CreateReleaseInputSchema);
    if (!body.ok) {
      return body.response;
    }
    const created = await deps.repo.createRelease(body.data);
    return created === null
      ? c.json({ error: "Project not found." }, 404)
      : c.json(created, 201);
  });

  app.post("/api/v1/admin/import-bugsink", async (c) => {
    if (!isAuthorizedMutation(c, deps.machineToken)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await parseJsonBody(c, BugsinkImportRequestSchema);
    if (!body.ok) {
      return body.response;
    }
    const baseUrl = body.data.baseUrl ?? deps.bugsinkImportUrl;
    const token = deps.bugsinkImportToken;
    if (baseUrl === undefined || token === undefined) {
      return c.json(
        {
          error:
            "BUGSINK_IMPORT_URL and BUGSINK_IMPORT_TOKEN must be configured for Bugsink import.",
        },
        400,
      );
    }
    const result = await runBugsinkImport({
      baseUrl,
      token,
      repo: deps.repo,
      dryRun: body.data.dryRun,
      concurrency: body.data.concurrency,
      projectId: body.data.projectId,
      fetchFn: deps.bugsinkFetchFn,
    });
    return c.json(result, 200);
  });
}

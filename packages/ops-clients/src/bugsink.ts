import { z } from "zod";
import {
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

const ProjectItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  digestedEventCount: z.number().int().nonnegative().optional(),
  storedEventCount: z.number().int().nonnegative().optional(),
});

const ProjectListSchema = z.object({
  items: z.array(ProjectItemSchema),
});

const IssueItemSchema = z.object({
  id: z.string(),
  projectId: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  digestedEventCount: z.number().int().nonnegative(),
  type: z.string(),
  value: z.string(),
  transaction: z.string(),
  state: z.enum(["OPEN", "RESOLVED", "RESOLVED_NEXT_RELEASE", "MUTED"]),
});

const IssuePageSchema = z.object({
  items: z.array(IssueItemSchema),
  nextCursor: z.string().nullable(),
});

export type BugsinkProject = {
  id: number;
  name: string;
  slug: string;
  digested_event_count?: number | undefined;
  stored_event_count?: number | undefined;
};

export type BugsinkIssue = {
  id: string;
  projectId: number;
  firstSeen: string;
  lastSeen: string;
  events: number;
  type: string;
  value: string;
  transaction: string;
  muted: boolean;
};

export type BugsinkProjectSummary = {
  project: BugsinkProject;
  activeIssues7d: number;
  staleIssues: number;
  mutedIssues: number;
  digestedEventsTotal: number;
  topIssues: BugsinkIssue[];
};

const MAX_PAGES = 100;
const PROJECT_FETCH_CONCURRENCY = 4;
const ACTIVE_WINDOW_MS = 7 * 86_400_000;
const TOP_ISSUES_LIMIT = 10;

async function mapConcurrent<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const results = Array.from<TOutput>({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item !== undefined) {
        results[current] = await mapper(item, current);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Read-only client for the first-party `@shepherdjerred/errors` service
 * (`/api/v1/`), preserving the `Bugsink*` wire types for Hub facets and
 * Temporal replay determinism.
 */
export class BugsinkClient {
  readonly #apiRoot: URL;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; token?: string; fetch?: Fetch }) {
    this.#apiRoot = new URL("/api/v1/", options.baseUrl);
    this.#fetch = options.fetch ?? fetch;
  }

  async projects(): Promise<BugsinkProject[]> {
    const body = await fetchJson(
      this.#fetch,
      {
        upstream: "bugsink",
        url: new URL("projects", this.#apiRoot),
        init: { headers: { accept: "application/json" } },
      },
      ProjectListSchema,
    );
    return body.items.map((item) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      ...(item.digestedEventCount === undefined
        ? {}
        : { digested_event_count: item.digestedEventCount }),
      ...(item.storedEventCount === undefined
        ? {}
        : { stored_event_count: item.storedEventCount }),
    }));
  }

  /** Unresolved issues of one project, muted ones included and flagged. */
  async unresolvedIssues(projectId: number): Promise<BugsinkIssue[]> {
    const collected: z.infer<typeof IssueItemSchema>[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = new URL("issues", this.#apiRoot);
      url.searchParams.set("project", String(projectId));
      url.searchParams.set("tab", "all");
      url.searchParams.set("limit", "200");
      if (cursor !== null) {
        if (seenCursors.has(cursor)) {
          throw new UpstreamError(
            "bugsink",
            `refusing repeated cursor on page ${String(page)}`,
          );
        }
        seenCursors.add(cursor);
        url.searchParams.set("cursor", cursor);
      }

      const body = await fetchJson(
        this.#fetch,
        {
          upstream: "bugsink",
          url,
          init: { headers: { accept: "application/json" } },
        },
        IssuePageSchema,
      );
      collected.push(...body.items);
      if (body.nextCursor === null || body.nextCursor === "") {
        return collected
          .filter(
            (issue) =>
              issue.state !== "RESOLVED" &&
              issue.state !== "RESOLVED_NEXT_RELEASE",
          )
          .map((issue) => ({
            id: issue.id,
            projectId: issue.projectId,
            firstSeen: issue.firstSeen,
            lastSeen: issue.lastSeen,
            events: issue.digestedEventCount,
            type: issue.type,
            value: issue.value,
            transaction: issue.transaction,
            muted: issue.state === "MUTED",
          }));
      }
      cursor = body.nextCursor;
    }

    throw new UpstreamError("bugsink", `more than ${String(MAX_PAGES)} pages`);
  }

  /**
   * Fetch all projects and their unresolved issues with bounded concurrency (4)
   * and compute 7d active, stale, muted, event totals, and top issues.
   */
  async allProjectsSummary(now = new Date()): Promise<BugsinkProjectSummary[]> {
    const projectList = await this.projects();
    const nowMs = now.getTime();

    return await mapConcurrent(
      projectList,
      PROJECT_FETCH_CONCURRENCY,
      async (project) => {
        const issues = await this.unresolvedIssues(project.id);
        let activeIssues7d = 0;
        let staleIssues = 0;
        let mutedIssues = 0;
        let unresolvedEventsSum = 0;
        const unmuted: BugsinkIssue[] = [];

        for (const issue of issues) {
          unresolvedEventsSum += issue.events;
          if (issue.muted) {
            mutedIssues += 1;
            continue;
          }
          unmuted.push(issue);
          const ageMs = nowMs - Date.parse(issue.lastSeen);
          if (ageMs <= ACTIVE_WINDOW_MS) {
            activeIssues7d += 1;
          } else {
            staleIssues += 1;
          }
        }

        const topIssues = unmuted
          .toSorted(
            (left, right) =>
              right.events - left.events ||
              Date.parse(right.lastSeen) - Date.parse(left.lastSeen),
          )
          .slice(0, TOP_ISSUES_LIMIT);

        return {
          project,
          activeIssues7d,
          staleIssues,
          mutedIssues,
          digestedEventsTotal:
            project.digested_event_count ?? unresolvedEventsSum,
          topIssues,
        };
      },
    );
  }
}

/** First-party Errors console link for one issue. */
export function bugsinkIssueUrl(baseUrl: string, issueId: string): string {
  return new URL(`/issues/${encodeURIComponent(issueId)}`, baseUrl).toString();
}

/** First-party Errors console link for a project's issue list. */
export function bugsinkProjectUrl(
  baseUrl: string,
  projectIdOrSlug: number | string,
): string {
  return typeof projectIdOrSlug === "string"
    ? new URL(
        `/projects/${encodeURIComponent(projectIdOrSlug)}`,
        baseUrl,
      ).toString()
    : new URL(`/issues/${String(projectIdOrSlug)}`, baseUrl).toString();
}

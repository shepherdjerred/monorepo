import { z } from "zod";
import {
  bearer,
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

const ProjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  digested_event_count: z.number().int().nonnegative().optional(),
  stored_event_count: z.number().int().nonnegative().optional(),
});

const IssueSchema = z.object({
  id: z.string(),
  project: z.number().int(),
  first_seen: z.string(),
  last_seen: z.string(),
  digested_event_count: z.number().int().nonnegative(),
  calculated_type: z.string(),
  calculated_value: z.string(),
  transaction: z.string(),
  is_resolved: z.boolean(),
  is_muted: z.boolean(),
});

export type BugsinkProject = z.infer<typeof ProjectSchema>;

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
 * Read-only Bugsink canonical API client. List endpoints are cursor
 * paginated; every page is followed, and a `next` link on another origin or
 * a repeated cursor fails loudly instead of returning a partial list.
 */
export class BugsinkClient {
  readonly #apiRoot: URL;
  readonly #token: string;
  readonly #fetch: Fetch;

  constructor(options: { baseUrl: string; token: string; fetch?: Fetch }) {
    this.#apiRoot = new URL("/api/canonical/0/", options.baseUrl);
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async #all<T extends z.ZodType>(first: URL, item: T): Promise<z.infer<T>[]> {
    const PageSchema = z.object({
      next: z.string().nullable(),
      results: z.array(item),
    });
    const results: z.infer<T>[] = [];
    const visited = new Set<string>();
    let url: URL | undefined = first;
    for (let page = 1; url !== undefined; page += 1) {
      if (page > MAX_PAGES) {
        throw new UpstreamError(
          "bugsink",
          `more than ${String(MAX_PAGES)} pages`,
        );
      }
      if (url.origin !== this.#apiRoot.origin || visited.has(url.href)) {
        throw new UpstreamError(
          "bugsink",
          `refusing pagination link on page ${String(page)}`,
        );
      }
      visited.add(url.href);
      const body: z.infer<typeof PageSchema> = await fetchJson(
        this.#fetch,
        {
          upstream: "bugsink",
          url,
          init: {
            headers: { accept: "application/json", ...bearer(this.#token) },
          },
        },
        PageSchema,
      );
      results.push(...body.results);
      url =
        body.next === null || body.next === "" ? undefined : new URL(body.next);
    }
    return results;
  }

  async projects(): Promise<BugsinkProject[]> {
    return await this.#all(new URL("projects/", this.#apiRoot), ProjectSchema);
  }

  /** Unresolved issues of one project, muted ones included and flagged. */
  async unresolvedIssues(projectId: number): Promise<BugsinkIssue[]> {
    const url = new URL("issues/", this.#apiRoot);
    url.searchParams.set("project", String(projectId));
    const issues = await this.#all(url, IssueSchema);
    return issues
      .filter((issue) => !issue.is_resolved)
      .map((issue) => ({
        id: issue.id,
        projectId: issue.project,
        firstSeen: issue.first_seen,
        lastSeen: issue.last_seen,
        events: issue.digested_event_count,
        type: issue.calculated_type,
        value: issue.calculated_value,
        transaction: issue.transaction,
        muted: issue.is_muted,
      }));
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

/** Bugsink web UI link for one issue's latest event. */
export function bugsinkIssueUrl(baseUrl: string, issueId: string): string {
  return new URL(
    `/issues/issue/${encodeURIComponent(issueId)}/event/last/`,
    baseUrl,
  ).toString();
}

/** Bugsink web UI link for a project's issue list. */
export function bugsinkProjectUrl(baseUrl: string, projectId: number): string {
  return new URL(`/issues/${String(projectId)}/`, baseUrl).toString();
}

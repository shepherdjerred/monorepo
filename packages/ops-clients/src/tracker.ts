import { z } from "zod";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@shepherdjerred/tracker/contract";
import { UpstreamError, type Fetch } from "./http.ts";

export type TrackerStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled"
  | "duplicate";

export type TrackerIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string | null;
  projectSlug?: string;
  projectName?: string;
  team: string;
  stateType: TrackerStateType;
};

export type TrackerOverview = {
  open: TrackerIssue[];
  counts: Record<string, Partial<Record<TrackerStateType, number>>>;
  triage: TrackerIssue[];
};

export type TrackerForumKind =
  "notice" | "discussion" | "question" | "decision";

export type TrackerForumPost = {
  id: string;
  identifier: string;
  kind: TrackerForumKind;
  title: string;
  url: string;
  scopes: string[];
  creatorKey: string;
  ownerKey: string | null;
  exitCondition: string | null;
  expiresAt: string | null;
  replyCount: number;
  answered: boolean;
  createdAt: string;
  lastActivityAt: string;
};

export type TrackerForumCoordination = {
  notices: TrackerForumPost[];
  unansweredQuestions: TrackerForumPost[];
};

export type TrackerProjectCounts = {
  id: string;
  slug: string;
  name: string;
  url: string;
  open: number;
  completed: number;
  completed7d: number;
};

export type TrackerCompletedThroughput = {
  total: number;
  byTeam: Record<string, number>;
  byProject: Record<string, number>;
  issues: TrackerIssue[];
};

export function summarizeTracker(
  open: readonly TrackerIssue[],
): TrackerOverview {
  const counts: TrackerOverview["counts"] = {};
  for (const issue of open) {
    const team = (counts[issue.team] ??= {});
    team[issue.stateType] = (team[issue.stateType] ?? 0) + 1;
  }
  return {
    open: [...open],
    counts,
    triage: open.filter((issue) => issue.stateType === "triage"),
  };
}

const StateTypeEnumSchema = z.enum([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
]);

const IssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().nullable().optional(),
  project: z
    .object({ slug: z.string().min(1), name: z.string() })
    .nullable()
    .optional(),
  team: z.object({ key: z.string().min(1) }),
  state: z.object({ type: StateTypeEnumSchema }),
});

const PageSchema = z.object({
  items: z.array(IssueSchema),
  nextCursor: z.string().nullable(),
});

const ForumPostItemSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  kind: z.enum(["notice", "discussion", "question", "decision"]),
  title: z.string(),
  scopes: z.array(z.string()).default([]),
  creator: z.object({ key: z.string().min(1) }),
  owner: z
    .object({ key: z.string().min(1) })
    .nullable()
    .default(null),
  exitCondition: z.string().nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  replyCount: z.number().int().nonnegative().default(0),
  answered: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
});

const ForumPageSchema = z.object({
  items: z.array(ForumPostItemSchema),
  nextCursor: z.string().nullable(),
});

const ProjectListSchema = z.array(
  z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string(),
  }),
);

function accumulateProjectCounts(
  projects: readonly { id: string; slug: string; name: string }[],
  open: readonly TrackerIssue[],
  completed: readonly TrackerIssue[],
  cutoffMs: number,
): Map<string, { open: number; completed: number; completed7d: number }> {
  const countsBySlug = new Map<
    string,
    { open: number; completed: number; completed7d: number }
  >();
  for (const project of projects) {
    countsBySlug.set(project.slug, { open: 0, completed: 0, completed7d: 0 });
  }
  for (const issue of open) {
    const entry =
      issue.projectSlug === undefined
        ? undefined
        : countsBySlug.get(issue.projectSlug);
    if (entry !== undefined) {
      entry.open += 1;
    }
  }
  for (const issue of completed) {
    const entry =
      issue.projectSlug === undefined
        ? undefined
        : countsBySlug.get(issue.projectSlug);
    if (entry !== undefined) {
      entry.completed += 1;
      const stamp = issue.completedAt ?? issue.updatedAt ?? issue.createdAt;
      if (Date.parse(stamp) >= cutoffMs) {
        entry.completed7d += 1;
      }
    }
  }
  return countsBySlug;
}
const SEVEN_DAYS_MS = 7 * 86_400_000;
const MAX_PAGES = 100;

function mapIssue(
  issue: z.infer<typeof IssueSchema>,
  publicUrl: string,
): TrackerIssue {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    createdAt: issue.createdAt,
    ...(issue.updatedAt === undefined ? {} : { updatedAt: issue.updatedAt }),
    ...(issue.completedAt === undefined
      ? {}
      : { completedAt: issue.completedAt }),
    ...(issue.project === null || issue.project === undefined
      ? {}
      : {
          projectSlug: issue.project.slug,
          projectName: issue.project.name,
        }),
    team: issue.team.key,
    stateType: issue.state.type,
    url: `${publicUrl}/issues/${issue.identifier}`,
  };
}

/** Credentialless, read-only tRPC client. Errors never expose issue content. */
export class TrackerClient {
  readonly #url: string;
  readonly #publicUrl: string;
  readonly #client;

  constructor(options: { baseUrl: string; publicUrl: string; fetch?: Fetch }) {
    this.#url = trackerUrl(options.baseUrl);
    this.#publicUrl = trackerUrl(options.publicUrl);
    this.#client = createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: `${this.#url}/trpc`,
          fetch: async (input: string | URL, init) => {
            const response = await (options.fetch ?? fetch)(input, {
              ...init,
              signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) {
              await response.body?.cancel();
              throw new UpstreamError(
                "tracker",
                `HTTP ${String(response.status)}`,
                response.status,
              );
            }
            return {
              status: response.status,
              ok: response.ok,
              headers: response.headers,
              json: (): Promise<unknown> => response.json(),
              text: () => response.text(),
              body: null,
            };
          },
        }),
      ],
    });
  }

  async #listIssuesByStates(
    states: readonly TrackerStateType[],
    sort: "created" | "updated",
    stopBeforeMs?: number,
  ): Promise<TrackerIssue[]> {
    const issues: TrackerIssue[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const parsed = PageSchema.safeParse(
        await this.#client.issues.list.query({
          states: [...states],
          labels: [],
          sort,
          includeArchived: false,
          limit: 250,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      if (!parsed.success) {
        throw new UpstreamError(
          "tracker",
          "response did not match issue schema",
        );
      }
      for (const raw of parsed.data.items) {
        if (
          stopBeforeMs !== undefined &&
          sort === "updated" &&
          raw.updatedAt !== undefined &&
          Date.parse(raw.updatedAt) < stopBeforeMs
        ) {
          return issues;
        }
        issues.push(mapIssue(raw, this.#publicUrl));
      }
      const next = parsed.data.nextCursor;
      if (next === null) {
        return issues;
      }
      if (cursors.has(next)) {
        throw new UpstreamError("tracker", "repeated issue cursor");
      }
      cursors.add(next);
      cursor = next;
    }
    throw new UpstreamError("tracker", "issue pagination exceeded limit");
  }

  async #listForumPosts(
    kind: "notice" | "question",
    state: "active" | "unanswered",
  ): Promise<TrackerForumPost[]> {
    const posts: TrackerForumPost[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const parsed = ForumPageSchema.safeParse(
        await this.#client.forum.list.query({
          kind,
          state,
          scopes: [],
          unreadOnly: false,
          subscribedOnly: false,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      if (!parsed.success) {
        throw new UpstreamError(
          "tracker",
          "response did not match forum post schema",
        );
      }
      posts.push(
        ...parsed.data.items.map((post) => ({
          id: post.id,
          identifier: post.identifier,
          kind: post.kind,
          title: post.title,
          url: `${this.#publicUrl}/forum/${post.identifier}`,
          scopes: post.scopes,
          creatorKey: post.creator.key,
          ownerKey: post.owner?.key ?? null,
          exitCondition: post.exitCondition,
          expiresAt: post.expiresAt,
          replyCount: post.replyCount,
          answered: post.answered,
          createdAt: post.createdAt,
          lastActivityAt: post.lastActivityAt,
        })),
      );
      const next = parsed.data.nextCursor;
      if (next === null) {
        return posts;
      }
      if (cursors.has(next)) {
        throw new UpstreamError("tracker", "repeated forum cursor");
      }
      cursors.add(next);
      cursor = next;
    }
    throw new UpstreamError("tracker", "forum pagination exceeded limit");
  }

  async openIssues(): Promise<TrackerIssue[]> {
    return await this.#listIssuesByStates(
      ["triage", "backlog", "unstarted", "started"],
      "created",
    );
  }

  async overview(): Promise<TrackerOverview> {
    return summarizeTracker(await this.openIssues());
  }

  /** Active coordination notices in Tracker Forum. */
  async activeForumNotices(): Promise<TrackerForumPost[]> {
    return await this.#listForumPosts("notice", "active");
  }

  /** Open unanswered questions in Tracker Forum. */
  async unansweredForumQuestions(): Promise<TrackerForumPost[]> {
    return await this.#listForumPosts("question", "unanswered");
  }

  /** Both active forum notices and open unanswered questions. */
  async activeForumCoordination(): Promise<TrackerForumCoordination> {
    const [notices, unansweredQuestions] = await Promise.all([
      this.activeForumNotices(),
      this.unansweredForumQuestions(),
    ]);
    return { notices, unansweredQuestions };
  }

  /** Issues completed over the trailing 7-day window. */
  async completedThroughput7d(
    now = new Date(),
  ): Promise<TrackerCompletedThroughput> {
    const cutoffMs = now.getTime() - SEVEN_DAYS_MS;
    const candidates = await this.#listIssuesByStates(
      ["completed"],
      "updated",
      cutoffMs,
    );
    const completed = candidates.filter((issue) => {
      const stamp = issue.completedAt ?? issue.updatedAt ?? issue.createdAt;
      return Date.parse(stamp) >= cutoffMs;
    });

    const byTeam: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    for (const issue of completed) {
      byTeam[issue.team] = (byTeam[issue.team] ?? 0) + 1;
      const projectKey = issue.projectSlug ?? "(unassigned)";
      byProject[projectKey] = (byProject[projectKey] ?? 0) + 1;
    }

    return {
      total: completed.length,
      byTeam,
      byProject,
      issues: completed,
    };
  }

  /** Open, lifetime completed, and 7d completed counts per non-archived project. */
  async projectIssueCounts(now = new Date()): Promise<TrackerProjectCounts[]> {
    const cutoffMs = now.getTime() - SEVEN_DAYS_MS;
    const [rawProjects, open, completed] = await Promise.all([
      this.#client.projects.list.query({ includeArchived: false }),
      this.openIssues(),
      this.#listIssuesByStates(["completed"], "created"),
    ]);
    const parsedProjects = ProjectListSchema.safeParse(rawProjects);
    if (!parsedProjects.success) {
      throw new UpstreamError(
        "tracker",
        "response did not match project schema",
      );
    }

    const countsBySlug = accumulateProjectCounts(
      parsedProjects.data,
      open,
      completed,
      cutoffMs,
    );

    return parsedProjects.data.map((project) => {
      const counts = countsBySlug.get(project.slug) ?? {
        open: 0,
        completed: 0,
        completed7d: 0,
      };
      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        url: `${this.#publicUrl}/projects/${project.slug}`,
        open: counts.open,
        completed: counts.completed,
        completed7d: counts.completed7d,
      };
    });
  }
}

function trackerUrl(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Tracker requires an HTTP(S) base URL without credentials, query or fragment",
    );
  }
  return url.toString().replace(/\/$/u, "");
}

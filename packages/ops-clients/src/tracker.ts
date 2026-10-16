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
  team: string;
  stateType: TrackerStateType;
};
export type TrackerOverview = {
  open: TrackerIssue[];
  counts: Record<string, Partial<Record<TrackerStateType, number>>>;
  triage: TrackerIssue[];
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

const IssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string(),
  createdAt: z.iso.datetime(),
  team: z.object({ key: z.string().min(1) }),
  state: z.object({
    type: z.enum([
      "triage",
      "backlog",
      "unstarted",
      "started",
      "completed",
      "canceled",
      "duplicate",
    ]),
  }),
});
const PageSchema = z.object({
  items: z.array(IssueSchema),
  nextCursor: z.string().nullable(),
});

/** Credentialless, read-only tRPC client. Errors never expose issue content. */
export class TrackerClient {
  readonly #url: string;
  readonly #client;
  constructor(options: { baseUrl: string; fetch?: Fetch }) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Tracker requires an HTTP(S) base URL without credentials, query or fragment",
      );
    this.#url = url.toString().replace(/\/$/u, "");
    this.#client = createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: this.#url + "/trpc",
          fetch: async (input: string | URL, init) => {
            const response = await (options.fetch ?? fetch)(input, {
              ...init,
              signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) {
              await response.body?.cancel();
              throw new UpstreamError(
                "tracker",
                "HTTP " + String(response.status),
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
  async openIssues(): Promise<TrackerIssue[]> {
    const issues: TrackerIssue[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const parsed = PageSchema.safeParse(
        await this.#client.issues.list.query({
          states: ["triage", "backlog", "unstarted", "started"],
          labels: [],
          sort: "created",
          includeArchived: false,
          limit: 250,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      if (!parsed.success)
        throw new UpstreamError(
          "tracker",
          "response did not match issue schema",
        );
      issues.push(
        ...parsed.data.items.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          createdAt: issue.createdAt,
          team: issue.team.key,
          stateType: issue.state.type,
          url: this.#url + "/issues/" + issue.identifier,
        })),
      );
      const next = parsed.data.nextCursor;
      if (next === null) return issues;
      if (cursors.has(next))
        throw new UpstreamError("tracker", "repeated issue cursor");
      cursors.add(next);
      cursor = next;
    }
  }
  async overview(): Promise<TrackerOverview> {
    return summarizeTracker(await this.openIssues());
  }
}

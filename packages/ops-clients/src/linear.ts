import { z } from "zod";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const STATE_TYPES = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
] as const;

export type LinearStateType = (typeof STATE_TYPES)[number];

const OpenIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.url(),
  createdAt: z.string(),
  team: z.object({ key: z.string() }),
  state: z.object({ type: z.enum(STATE_TYPES) }),
});

const TeamSchema = z.object({
  key: z.string(),
  name: z.string(),
  activeCycle: z
    .object({
      number: z.number().int(),
      startsAt: z.string(),
      endsAt: z.string(),
      progress: z.number(),
    })
    .nullable(),
});

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  team: string;
  stateType: LinearStateType;
};

export type LinearCycle = {
  team: string;
  teamName: string;
  number: number;
  startsAt: string;
  endsAt: string;
  /** 0..1 completion as Linear reports it. */
  progress: number;
};

export type LinearOverview = {
  /** Every issue not completed or canceled. */
  open: LinearIssue[];
  /** Open issue counts by `team` then state type. */
  counts: Record<string, Partial<Record<LinearStateType, number>>>;
  triage: LinearIssue[];
  cycles: LinearCycle[];
};

const OPEN_ISSUES = `
query OpenIssues($after: String) {
  issues(first: 250, after: $after, filter: {state: {type: {nin: ["completed", "canceled", "duplicate"]}}}) {
    pageInfo { hasNextPage endCursor }
    nodes { id identifier title url createdAt team { key } state { type } }
  }
}`;

const TEAMS = `
query Teams {
  teams(first: 100) {
    nodes { key name activeCycle { number startsAt endsAt progress } }
  }
}`;

const MAX_PAGES = 20;

export function summarizeLinear(
  open: readonly LinearIssue[],
  cycles: readonly LinearCycle[],
): LinearOverview {
  const counts: LinearOverview["counts"] = {};
  for (const issue of open) {
    const team = (counts[issue.team] ??= {});
    team[issue.stateType] = (team[issue.stateType] ?? 0) + 1;
  }
  return {
    open: [...open],
    counts,
    triage: open.filter((issue) => issue.stateType === "triage"),
    cycles: [...cycles],
  };
}

/** Read-only Linear client authenticated with a personal API key. */
export class LinearClient {
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  constructor(options: { apiKey: string; fetch?: Fetch }) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
  }

  async #query<T extends z.ZodType>(
    query: string,
    variables: Record<string, unknown>,
    schema: T,
  ): Promise<z.infer<T>> {
    // Personal API keys go in Authorization without a Bearer scheme.
    return await postGraphql(
      this.#fetch,
      {
        upstream: "linear",
        url: LINEAR_GRAPHQL_URL,
        headers: { authorization: this.#apiKey },
        query,
        variables,
      },
      schema,
    );
  }

  async openIssues(): Promise<LinearIssue[]> {
    const schema = z.object({
      issues: z.object({
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
        nodes: z.array(OpenIssueSchema),
      }),
    });
    const issues: LinearIssue[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: z.infer<typeof schema> = await this.#query(
        OPEN_ISSUES,
        { after },
        schema,
      );
      issues.push(
        ...data.issues.nodes.map((issue) => ({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          url: issue.url,
          createdAt: issue.createdAt,
          team: issue.team.key,
          stateType: issue.state.type,
        })),
      );
      if (!data.issues.pageInfo.hasNextPage) {
        return issues;
      }
      after = data.issues.pageInfo.endCursor;
    }
    throw new Error(`Linear open issues exceeded ${String(MAX_PAGES)} pages`);
  }

  async activeCycles(): Promise<LinearCycle[]> {
    const data = await this.#query(
      TEAMS,
      {},
      z.object({ teams: z.object({ nodes: z.array(TeamSchema) }) }),
    );
    return data.teams.nodes.flatMap((team) =>
      team.activeCycle === null
        ? []
        : [
            {
              team: team.key,
              teamName: team.name,
              number: team.activeCycle.number,
              startsAt: team.activeCycle.startsAt,
              endsAt: team.activeCycle.endsAt,
              progress: team.activeCycle.progress,
            },
          ],
    );
  }

  async overview(): Promise<LinearOverview> {
    const open = await this.openIssues();
    return summarizeLinear(open, await this.activeCycles());
  }
}

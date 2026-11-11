import { QueryClient } from "@tanstack/react-query";
import type { BootstrapData, Issue, IssueDetailData } from "./api.ts";
import { bootstrapKey, issueKey, type IssueListData } from "./cache.ts";

const at = "2026-01-01T00:00:00.000Z";
const team = { id: "team-ai", key: "AI", name: "AI", issueCounter: 9 };

function actor(key: string, name: string): BootstrapData["actors"][number] {
  return {
    id: `actor-${key}`,
    key,
    kind: "human",
    name,
    firstSeenAt: at,
    lastSeenAt: at,
    seenCount: 1,
    firstMetadata: {},
    metadata: {},
  };
}

function state(
  name: string,
  type: BootstrapData["states"][number]["type"],
  position: number,
): BootstrapData["states"][number] {
  return {
    id: `state-${type}`,
    teamId: team.id,
    name,
    type,
    color: "#888888",
    position,
  };
}

/** A small workspace: three states, two labels, one project, two actors, no saved views. */
export const workspaceFixture: BootstrapData = {
  teams: [team],
  states: [
    state("Todo", "unstarted", 0),
    state("In progress", "started", 1),
    state("Done", "completed", 2),
  ],
  labels: [
    { id: "label-bug", teamId: team.id, name: "bug", color: "#e46169" },
    { id: "label-feature", teamId: team.id, name: "feature", color: "#8b5cf6" },
  ],
  projects: [
    {
      id: "project-toolkit",
      slug: "toolkit",
      name: "Toolkit",
      description: "",
      color: "#8b5cf6",
      archivedAt: null,
    },
  ],
  actors: [actor("human:jerred", "Jerred"), actor("agent:helper", "Helper")],
  views: [],
  writesEnabled: true,
};

function found<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("The fixture workspace is missing a record");
  }
  return value;
}

/** Issue `AI-<number>`, in Todo at revision 1 unless overridden. */
export function issueFixture(
  number: number,
  overrides: Partial<Issue> = {},
): Issue {
  const todo = found(workspaceFixture.states[0]);
  const creator = found(workspaceFixture.actors[0]);
  return {
    id: `issue-${String(number)}`,
    teamId: team.id,
    team,
    number,
    identifier: `AI-${String(number)}`,
    title: `Issue ${String(number)}`,
    description: "",
    stateId: todo.id,
    state: todo,
    priority: 0,
    projectId: null,
    project: null,
    assigneeId: null,
    assignee: null,
    creatorId: creator.id,
    creator,
    boardOrder: number * 1024,
    voteCount: 0,
    revision: 1,
    externalRef: null,
    sourceMetadata: null,
    createdAt: at,
    updatedAt: at,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    labels: [],
    parentId: null,
    dueDate: null,
    parent: null,
    childCount: 0,
    completedChildCount: 0,
    ...overrides,
  };
}

export function detailFixture(issue: Issue): IssueDetailData {
  return {
    ...issue,
    comments: [],
    attachments: [],
    votes: [],
    viewerVoted: false,
    relations: [],
    children: [],
  };
}

/**
 * A query client holding the workspace, one two-page list and one filtered
 * list, with `AI-1` cached in both lists and as a detail.
 */
export function cacheFixture() {
  const client = new QueryClient();
  const first = issueFixture(1);
  client.setQueryData(bootstrapKey, workspaceFixture);
  client.setQueryData<IssueListData>(["issues", { teamKey: "AI" }], {
    pages: [
      { items: [first, issueFixture(2)], nextCursor: "issue-2" },
      { items: [issueFixture(3)], nextCursor: null },
    ],
    pageParams: [undefined, "issue-2"],
  });
  client.setQueryData<IssueListData>(
    ["issues", { teamKey: "AI", states: ["Todo"] }],
    {
      pages: [{ items: [first], nextCursor: null }],
      pageParams: [undefined],
    },
  );
  client.setQueryData(issueKey("AI-1"), detailFixture(first));
  return client;
}

/** Everything the cache shows for the issues, for before/after comparisons. */
export function cacheSnapshot(client: QueryClient) {
  return structuredClone({
    lists: client.getQueriesData({ queryKey: ["issues"] }),
    details: client.getQueriesData({ queryKey: ["issue"] }),
  });
}

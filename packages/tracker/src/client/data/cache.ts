import type { QueryClient } from "@tanstack/react-query";
import type { Issue, IssueDetailData } from "./api.ts";

/** One page of `issues.list`; every `["issues", …]` query caches pages of these. */
export type IssuePage = { items: Issue[]; nextCursor: string | null };
/** The cached shape of an infinite `issues.list` query. */
export type IssueListData = {
  pages: IssuePage[];
  pageParams: (string | undefined)[];
};

/** The fields an optimistic edit may rewrite on any cached copy of an issue. */
export type IssuePatch = Partial<
  Pick<
    Issue,
    | "title"
    | "description"
    | "priority"
    | "state"
    | "stateId"
    | "assignee"
    | "assigneeId"
    | "project"
    | "projectId"
    | "labels"
    | "archivedAt"
    | "boardOrder"
    | "voteCount"
    | "parent"
    | "parentId"
    | "dueDate"
  >
> & { viewerVoted?: boolean };

/** What the cache knows about one issue, whichever query it came from. */
export type CachedIssue = Issue & { viewerVoted?: boolean };

export const listsKey = ["issues"] as const;
export const bootstrapKey = ["bootstrap"] as const;
export const issueKey = (identifier: string) => ["issue", identifier] as const;
export const eventsKey = (identifier: string) =>
  ["events", identifier] as const;

function listRows(client: QueryClient, identifier: string) {
  return client
    .getQueriesData<IssueListData>({ queryKey: listsKey })
    .flatMap(([, data]) => data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((row) => row.identifier === identifier);
}

/** Every distinct issue held by any cached list. */
export function cachedRows(client: QueryClient) {
  const rows = new Map<string, Issue>();
  for (const [, data] of client.getQueriesData<IssueListData>({
    queryKey: listsKey,
  })) {
    for (const row of data?.pages.flatMap((page) => page.items) ?? []) {
      const known = rows.get(row.id);
      if (known === undefined || known.revision < row.revision) {
        rows.set(row.id, row);
      }
    }
  }
  return [...rows.values()];
}

/** The most recent cached copy of an issue: its detail, else its newest row. */
export function cachedIssue(
  client: QueryClient,
  identifier: string,
): CachedIssue | undefined {
  const detail = client.getQueryData<IssueDetailData>(issueKey(identifier));
  let newest: CachedIssue | undefined = detail;
  for (const row of listRows(client, identifier)) {
    if (newest === undefined || row.revision > newest.revision) {
      newest = row;
    }
  }
  return newest;
}

function mapRows(
  data: IssueListData | undefined,
  change: (items: Issue[]) => Issue[],
) {
  if (data === undefined) {
    return data;
  }
  const pages = data.pages.map((page) => {
    const items = change(page.items);
    return items === page.items ? page : { ...page, items };
  });
  // Untouched pages and lists keep their identity, so nothing re-renders.
  return pages.some((page, index) => page !== data.pages[index])
    ? { ...data, pages }
    : data;
}

type Child = IssueDetailData["children"][number];

const childOf = (issue: CachedIssue): Child => ({
  identifier: issue.identifier,
  title: issue.title,
  state: issue.state,
  priority: issue.priority,
  assignee: issue.assignee,
});

/** The sub-issues a parent shows once one of them changed as `child`. */
function withChild(
  parent: IssueDetailData,
  child: CachedIssue,
): Child[] | undefined {
  const index = parent.children.findIndex(
    ({ identifier }) => identifier === child.identifier,
  );
  // Archived sub-issues are not listed or counted, as on the server.
  const belongs =
    child.parent?.identifier === parent.identifier && child.archivedAt === null;
  if (index === -1) {
    return belongs ? [...parent.children, childOf(child)] : undefined;
  }
  if (!belongs) {
    return parent.children.filter((_, at) => at !== index);
  }
  const next = childOf(child);
  const known = parent.children[index];
  return known !== undefined && JSON.stringify(known) === JSON.stringify(next)
    ? undefined
    : parent.children.map((item, at) => (at === index ? next : item));
}

const childCounts = (children: readonly Child[]) => ({
  childCount: children.length,
  completedChildCount: children.filter(
    ({ state }) => state.type === "completed",
  ).length,
});

/**
 * Keep each cached parent's sub-issues, and the counts its rows show, in
 * step with an edit to one of them, so progress moves with the edit.
 */
function syncParents(client: QueryClient, child: CachedIssue) {
  const changed: IssueDetailData[] = [];
  for (const [key, detail] of client.getQueriesData<IssueDetailData>({
    queryKey: ["issue"],
  })) {
    if (detail === undefined || detail.identifier === child.identifier) {
      continue;
    }
    const children = withChild(detail, child);
    if (children !== undefined) {
      const next = { ...detail, children, ...childCounts(children) };
      client.setQueryData(key, next);
      changed.push(next);
    }
  }
  for (const parent of changed) {
    client.setQueriesData<IssueListData>({ queryKey: listsKey }, (data) =>
      mapRows(data, (items) =>
        items.some((row) => row.identifier === parent.identifier)
          ? items.map((row) =>
              row.identifier === parent.identifier
                ? {
                    ...row,
                    childCount: parent.childCount,
                    completedChildCount: parent.completedChildCount,
                  }
                : row,
            )
          : items,
      ),
    );
  }
}

/** Every cached detail an issue is listed under as a sub-issue. */
export function parentsOf(client: QueryClient, identifier: string) {
  const parents = new Set<string>();
  const parent = cachedIssue(client, identifier)?.parent?.identifier;
  if (parent !== undefined) {
    parents.add(parent);
  }
  for (const [, detail] of client.getQueriesData<IssueDetailData>({
    queryKey: ["issue"],
  })) {
    if (
      detail?.children.some((child) => child.identifier === identifier) === true
    ) {
      parents.add(detail.identifier);
    }
  }
  return [...parents];
}

/**
 * Write fields onto every cached copy of an issue. A list row never carries
 * `viewerVoted`; only the detail does. A parent that is cached sees the
 * change among its sub-issues.
 */
export function patchIssue(
  client: QueryClient,
  identifier: string,
  patch: IssuePatch,
  server?: Issue,
) {
  const known = cachedIssue(client, identifier);
  const { viewerVoted: _viewerVoted, ...rowPatch } = patch;
  client.setQueryData<IssueDetailData>(issueKey(identifier), (detail) =>
    detail === undefined ? detail : { ...detail, ...server, ...patch },
  );
  client.setQueriesData<IssueListData>({ queryKey: listsKey }, (data) =>
    mapRows(data, (items) =>
      items.some((row) => row.identifier === identifier)
        ? items.map((row) =>
            row.identifier === identifier
              ? { ...row, ...server, ...rowPatch }
              : row,
          )
        : items,
    ),
  );
  if (known !== undefined) {
    syncParents(client, { ...known, ...server, ...rowPatch });
  }
}

/** Drop an issue from every cached list and forget its detail and history. */
export function forgetIssue(client: QueryClient, identifier: string) {
  client.setQueriesData<IssueListData>({ queryKey: listsKey }, (data) =>
    mapRows(data, (items) =>
      items.some((row) => row.identifier === identifier)
        ? items.filter((row) => row.identifier !== identifier)
        : items,
    ),
  );
  client.removeQueries({ queryKey: issueKey(identifier) });
  client.removeQueries({ queryKey: eventsKey(identifier) });
}

/** Change the detail of one issue, leaving it alone when it is not cached. */
export function patchDetail(
  client: QueryClient,
  identifier: string,
  change: (detail: IssueDetailData) => IssueDetailData,
) {
  client.setQueryData<IssueDetailData>(issueKey(identifier), (detail) =>
    detail === undefined ? detail : change(detail),
  );
}

/** Refetch what one issue's mutation can have changed, and nothing else. */
export function invalidateIssue(client: QueryClient, identifier: string) {
  // A parent's progress and sub-issue list depend on its children.
  for (const parent of parentsOf(client, identifier)) {
    void client.invalidateQueries({ queryKey: issueKey(parent) });
  }
  void client.invalidateQueries({ queryKey: issueKey(identifier) });
  void client.invalidateQueries({ queryKey: eventsKey(identifier) });
  void client.invalidateQueries({ queryKey: listsKey });
}

export type Outcome<T = undefined> =
  { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Show a change before the server confirms it. `apply` makes the change and
 * returns how to take back exactly that change, so two overlapping mutations
 * never undo each other; `settle` refetches what the mutation touched.
 */
export async function optimistic<T>(steps: {
  apply: () => () => void;
  run: () => Promise<T>;
  settle: () => void;
}): Promise<Outcome<T>> {
  const rollback = steps.apply();
  try {
    return { ok: true, value: await steps.run() };
  } catch (error) {
    rollback();
    return { ok: false, error };
  } finally {
    steps.settle();
  }
}

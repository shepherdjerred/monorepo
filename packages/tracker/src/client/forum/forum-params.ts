import {
  ForumKindSchema,
  ForumListSchema,
  ForumSortSchema,
  type ForumKind,
  type ForumListInput,
  type ForumSort,
} from "#shared/forum.ts";

export type ForumStateFilter = ForumListInput["state"];

export type ForumFilters = {
  query: string;
  kind: ForumKind | "";
  state: ForumStateFilter;
  explicitState: boolean;
  project: string;
  scope: string;
  sort: ForumSort | "";
  inbox: boolean;
  unread: boolean;
};

export const noProjectFilterValue = "__none__";

export function readForumFilters(params: URLSearchParams): ForumFilters {
  const query = params.get("q") ?? "";
  const rawKind = params.get("kind") ?? "";
  const parsedKind = ForumKindSchema.safeParse(rawKind);
  const rawState = params.get("state");
  const parsedState = ForumListSchema.shape.state.safeParse(rawState);
  const explicitState = rawState !== null && parsedState.success;
  const state: ForumStateFilter = explicitState
    ? parsedState.data
    : query.trim() === ""
      ? "active"
      : "all";
  const rawSort = params.get("sort") ?? "";
  const parsedSort = ForumSortSchema.safeParse(rawSort);
  return {
    query,
    kind: parsedKind.success ? parsedKind.data : "",
    state,
    explicitState,
    project: params.get("project") ?? "",
    scope: params.get("scope") ?? "",
    sort: parsedSort.success ? parsedSort.data : "",
    inbox: params.get("inbox") === "1",
    unread: params.get("unread") === "1",
  };
}

export function updateForumParams(
  current: URLSearchParams,
  changes: Record<string, string | null | undefined>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return next;
}

export function hasActiveForumFilters(filters: ForumFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.kind !== "" ||
    filters.explicitState ||
    filters.project !== "" ||
    filters.scope.trim() !== "" ||
    filters.sort !== "" ||
    filters.inbox ||
    filters.unread
  );
}

export function toForumListInput(
  filters: ForumFilters,
  viewerActorKey: string,
): {
  kind?: ForumKind;
  scopes: string[];
  state: ForumStateFilter;
  projectSlug?: string | null;
  unreadOnly: boolean;
  subscribedOnly: boolean;
  viewerActorKey: string;
  sort?: ForumSort;
  query?: string;
  limit: number;
} {
  const trimmedScope = filters.scope.trim();
  const trimmedQuery = filters.query.trim();
  return {
    ...(filters.kind === "" ? {} : { kind: filters.kind }),
    scopes: trimmedScope === "" ? [] : [trimmedScope],
    state: filters.state,
    ...(filters.project === ""
      ? {}
      : {
          projectSlug:
            filters.project === noProjectFilterValue ? null : filters.project,
        }),
    unreadOnly: filters.unread,
    subscribedOnly: filters.inbox,
    viewerActorKey,
    ...(filters.sort === "" ? {} : { sort: filters.sort }),
    ...(trimmedQuery === "" ? {} : { query: trimmedQuery }),
    limit: 50,
  };
}

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import type { IssuePage } from "#client/data/cache.ts";
import { hiddenIssues } from "#client/data/mutations.ts";
import { IssueListSchema, type IssueListInput } from "#shared/schema.ts";
import { currentActor } from "#client/data/identity.ts";
import type { RouteInfo } from "#client/shell/route.ts";

export const listPageSize = 100;
const boardPageSize = 250;

/**
 * A board column has no window to scroll pages into, and a drag needs every
 * neighbouring card, so the board reads the whole team as one cached page.
 */
async function everyIssue(input: IssueListInput): Promise<IssuePage> {
  const items: IssuePage["items"] = [];
  let cursor: string | undefined;
  do {
    const page = await api.issues.list.query({
      ...input,
      ...(cursor === undefined ? {} : { cursor }),
    });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return { items, nextCursor: null };
}

/** The first page has no cursor; later ones carry the previous `nextCursor`. */
const firstCursor = (): string | undefined => undefined;

/**
 * One `issues.list` query, a page at a time. Issues whose delete is waiting
 * to be undone are left out, as is an issue archived a moment ago in a list
 * that excludes archived ones.
 */
export function useIssuePages(input: IssueListInput | undefined) {
  const whole = input?.sort === "board";
  const query = useInfiniteQuery({
    queryKey: ["issues", input],
    queryFn:
      input === undefined
        ? skipToken
        : ({ pageParam }) =>
            whole
              ? everyIssue(input)
              : api.issues.list.query({
                  ...input,
                  ...(pageParam === undefined ? {} : { cursor: pageParam }),
                }),
    initialPageParam: firstCursor(),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const hidden = useSyncExternalStore(hiddenIssues.subscribe, hiddenIssues.get);
  const pages = query.data?.pages;
  const includeArchived = input?.includeArchived === true;
  const items = useMemo(() => {
    // Rows can shift between pages while they load; show each issue once.
    const seen = new Set<string>();
    return (pages ?? [])
      .flatMap((page) => page.items)
      .filter((issue) => {
        if (
          seen.has(issue.id) ||
          hidden.has(issue.identifier) ||
          (!includeArchived && issue.archivedAt !== null)
        ) {
          return false;
        }
        seen.add(issue.id);
        return true;
      });
  }, [pages, hidden, includeArchived]);
  const moreFailed = query.isFetchNextPageError;
  return {
    items,
    /** Pages fetched so far; a restored list fetches this many again. */
    pageCount: pages?.length ?? 0,
    loading: query.isPending,
    /** Another filter's rows are standing in while this one loads. */
    placeholder: query.isPlaceholderData,
    /** Rows are shown and being revalidated or replaced. */
    busy:
      query.isPlaceholderData ||
      (query.isFetching && !query.isFetchingNextPage),
    error: moreFailed ? null : query.error,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    moreError: moreFailed ? query.error : null,
    loadMore: () => {
      void query.fetchNextPage({ cancelRefetch: false });
    },
  };
}
export type IssuePages = ReturnType<typeof useIssuePages>;

/**
 * The issues behind the list, board and project views. An issue page keeps
 * the list it was reached from, so previous/next follow that list.
 */
export function useIssueList(route: RouteInfo, teamKey: string | undefined) {
  const [params] = useSearchParams();
  const [remembered, setRemembered] = useState<IssueListInput>();
  const fromUrl =
    teamKey !== undefined && route.isList
      ? IssueListSchema.parse({
          teamKey,
          projectSlug: route.projectSlug ?? params.get("project") ?? undefined,
          search: params.get("q") ?? undefined,
          states: params.getAll("state"),
          labels: params.getAll("label"),
          assigneeKey:
            params.get("mine") === "true"
              ? currentActor().key
              : (params.get("assignee") ?? undefined),
          creatorKey: params.get("creator") ?? undefined,
          priority: params.has("priority")
            ? Number(params.get("priority"))
            : undefined,
          includeArchived: params.get("archived") === "true",
          sort:
            route.view === "board"
              ? "board"
              : (params.get("sort") ?? "updated"),
          limit: route.view === "board" ? boardPageSize : listPageSize,
        })
      : undefined;
  if (
    fromUrl !== undefined &&
    JSON.stringify(fromUrl) !== JSON.stringify(remembered)
  ) {
    setRemembered(fromUrl);
  }
  const fallback =
    teamKey !== undefined && route.view === "issue"
      ? (remembered ?? IssueListSchema.parse({ teamKey, limit: listPageSize }))
      : undefined;
  return useIssuePages(fromUrl ?? fallback);
}

const PeekStateSchema = z.object({ peek: z.literal("pushed") });

/**
 * The peeked issue lives in `?peek=`, so Back closes it and the URL can be
 * shared. Closing returns through history when this tab pushed the peek.
 */
export function usePeek(enabled: boolean) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const closing = useRef<string>(undefined);
  const identifier = enabled ? (params.get("peek") ?? undefined) : undefined;
  const state: unknown = location.state;
  const pushed = PeekStateSchema.safeParse(state).success;
  if (identifier === undefined) {
    // Leaving the peek re-arms the guard, so Forward to the same entry can close again.
    closing.current = undefined;
  }
  function open(next: string) {
    const search = new URLSearchParams(params);
    search.set("peek", next);
    setParams(search, {
      // Stepping between issues keeps one history entry for the peek.
      replace: identifier !== undefined,
      state: identifier === undefined ? { peek: "pushed" } : state,
      preventScrollReset: true,
    });
  }
  function close() {
    if (identifier === undefined || closing.current === location.key) {
      return;
    }
    closing.current = location.key;
    if (pushed) {
      void navigate(-1);
      return;
    }
    const search = new URLSearchParams(params);
    search.delete("peek");
    setParams(search, { replace: true, preventScrollReset: true });
  }
  return { identifier, open, close };
}

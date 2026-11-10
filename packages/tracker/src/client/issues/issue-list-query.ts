import { useRef, useState } from "react";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import { IssueListSchema, type IssueListInput } from "#shared/schema.ts";
import { currentActor } from "#client/data/identity.ts";
import type { RouteInfo } from "#client/shell/route.ts";

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
          limit: "all",
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
      ? (remembered ?? IssueListSchema.parse({ teamKey, limit: "all" }))
      : undefined;
  const input = fromUrl ?? fallback;
  return useQuery({
    queryKey: ["issues", input],
    queryFn:
      input === undefined ? skipToken : () => api.issues.list.query(input),
    placeholderData: keepPreviousData,
  });
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

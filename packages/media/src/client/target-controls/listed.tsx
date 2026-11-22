import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { DEFAULT_TARGET_UNAVAILABLE } from "#shared/editions/target-batch.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { ApiError } from "#client/api.ts";
import { readListedTargets, readTarget, useTarget } from "./api.ts";

type ListedTargetsState = {
  mediaIds: ReadonlySet<string>;
  /** The list's read failed, which every one of its rows reports. */
  error: Error | null;
  unavailable: ReadonlyMap<string, ApiError>;
};

const ListedTargetsContext = createContext<ListedTargetsState | null>(null);

/** Distinct and sorted, so reordering a list reads nothing new. */
function listedIds(mediaIds: readonly string[]): string[] {
  return [...new Set(mediaIds)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function listedTargetsKey(mediaIds: readonly string[]) {
  return ["targets", listedIds(mediaIds)] as const;
}

/**
 * Reads the default-target view of every title in a list with one request and
 * refreshes them together. Rows inside read theirs with `useListedTarget`.
 */
export function ListedTargets({
  mediaIds,
  children,
}: {
  mediaIds: readonly string[];
  children: ReactNode;
}) {
  const joined = listedIds(mediaIds).join(",");
  const ids = useMemo(() => (joined === "" ? [] : joined.split(",")), [joined]);
  const batch = useQuery({
    queryKey: listedTargetsKey(ids),
    enabled: ids.length > 0,
    queryFn: ({ signal }) => readListedTargets(ids, signal),
    refetchInterval: 15_000,
  });
  const state = useMemo(
    () => ({
      mediaIds: new Set(ids),
      error: batch.error,
      unavailable: new Map(
        (batch.data ?? []).map((item) => [
          item.mediaId,
          new ApiError(
            item.code,
            DEFAULT_TARGET_UNAVAILABLE[item.code].message,
            DEFAULT_TARGET_UNAVAILABLE[item.code].status,
          ),
        ]),
      ),
    }),
    [ids, batch.error, batch.data],
  );
  return <ListedTargetsContext value={state}>{children}</ListedTargetsContext>;
}

/**
 * The views of several of a list's rows at once, for an action that spans
 * them. Each is the view, the reason the reader has none, or neither while
 * the list's read is still on its way. Reads nothing itself.
 */
export function useListedTargetViews(mediaIds: readonly string[]): {
  mediaId: string;
  data: DefaultTargetView | undefined;
  error: Error | null;
}[] {
  const listed = useContext(ListedTargetsContext);
  const targets = useQueries({
    queries: mediaIds.map((mediaId) => ({
      queryKey: ["target", mediaId],
      queryFn: () => readTarget(mediaId),
      enabled: false,
    })),
  });
  return mediaIds.map((mediaId, index) => ({
    mediaId,
    data: targets[index]?.data,
    error: listed?.error ?? listed?.unavailable.get(mediaId) ?? null,
  }));
}

/** A row's view: from its list's read, or its own read when no list has it. */
export function useListedTarget(mediaId: string): {
  data: DefaultTargetView | undefined;
  error: Error | null;
} {
  const listed = useContext(ListedTargetsContext);
  const covered = listed?.mediaIds.has(mediaId) === true;
  const target = useTarget(mediaId, !covered);
  if (listed === null || !covered) return target;
  return {
    data: target.data,
    error: listed.error ?? listed.unavailable.get(mediaId) ?? null,
  };
}

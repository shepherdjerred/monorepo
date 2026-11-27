import { useQueries, useQuery } from "@tanstack/react-query";
import { api, keys } from "./api.ts";

/**
 * The waiting header follows the live stream (a `waiter` change); this slow
 * poll only covers a stream that is down or a tab that missed a message.
 */
const WAITER_FALLBACK_POLL_MS = 60_000;

export function useInbox() {
  return useQuery({
    queryKey: keys.inbox,
    queryFn: () => api.inbox.list.query(),
  });
}

export function useBoard(slug: string) {
  return useQuery({
    queryKey: keys.board(slug),
    queryFn: () => api.boards.get.query({ slug }),
  });
}

export function useArtifact(id: string) {
  return useQuery({
    queryKey: keys.artifact(id),
    queryFn: () => api.artifacts.get.query({ id }),
  });
}

export function useVersions(artifactId: string) {
  return useQuery({
    queryKey: keys.versions(artifactId),
    queryFn: () => api.artifacts.versions.query({ id: artifactId }),
  });
}

export function useVersion(id: string | undefined) {
  return useQuery({
    queryKey: keys.version(id ?? ""),
    queryFn: () => api.versions.get.query({ id: id ?? "" }),
    enabled: id !== undefined,
  });
}

export function useBoardThreads(slug: string) {
  return useQuery({
    queryKey: keys.boardThreads(slug),
    queryFn: () => api.threads.list.query({ board: slug }),
  });
}

export function useArtifactThreads(artifactId: string) {
  return useQuery({
    queryKey: keys.artifactThreads(artifactId),
    queryFn: () => api.threads.list.query({ artifactId }),
  });
}

/** Details (with the content URL) for the frames that render live. */
export function useArtifactDetails(ids: readonly string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.artifact(id),
      queryFn: () => api.artifacts.get.query({ id }),
    })),
  });
}

export function useWaiters(scope: { board?: string; artifactId?: string }) {
  return useQuery({
    queryKey: keys.waiters(JSON.stringify(scope)),
    queryFn: () => api.feedback.waiters.query(scope),
    refetchInterval: WAITER_FALLBACK_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function usePending(
  scope:
    { type: "artifact"; artifactId: string } | { type: "board"; board: string },
) {
  return useQuery({
    queryKey: keys.pending(JSON.stringify(scope)),
    queryFn: () => api.feedback.pending.query({ scope }),
    refetchInterval: WAITER_FALLBACK_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

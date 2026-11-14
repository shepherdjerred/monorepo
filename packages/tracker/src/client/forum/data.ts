import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/contract.ts";

export type Post =
  inferRouterOutputs<AppRouter>["forum"]["list"]["items"][number];
export function useRefreshForum() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["forum"] });
}

/** Refresh at the next server-observed expiry, without trusting the browser clock. */
export function expiryDelay(
  posts: Post[],
  checkedAt: string | undefined,
  receivedAt: number,
) {
  const deadlines = posts
    .filter(
      (post) =>
        post.state === "open" && !post.expired && post.expiresAt !== null,
    )
    .map((post) => Date.parse(post.expiresAt ?? ""));
  const deadline = Math.min(...deadlines);
  if (checkedAt === undefined || !Number.isFinite(deadline)) return false;
  const remaining =
    deadline - Date.parse(checkedAt) - (Date.now() - receivedAt);
  return Math.min(2_147_483_647, Math.max(1, remaining));
}

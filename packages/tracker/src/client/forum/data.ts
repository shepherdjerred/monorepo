import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/contract.ts";

type ForumOutputs = inferRouterOutputs<AppRouter>["forum"];

export type Post = ForumOutputs["list"]["items"][number];
export type PostDetail = ForumOutputs["byId"];
export type ForumReply = PostDetail["replies"][number];
export type ForumAttachment = PostDetail["attachments"][number];
export type ForumReaction = Post["reactions"][number];
export type ForumScopeItem = ForumOutputs["scopes"][number];

export const forumPostKey = (idOrIdent: string, viewerActorKey: string) =>
  ["forum", "post", idOrIdent, viewerActorKey] as const;

export function useRefreshForum() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["forum"] });
}

/** Refresh at the next server-observed expiry, without trusting the browser clock. */
export function expiryDelay(
  posts: readonly Pick<Post, "state" | "expired" | "expiresAt">[],
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

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Format an ISO 8601 timestamp into a local `YYYY-MM-DDTHH:mm` value for `<input type="datetime-local">`. */
export function toLocalDateTimeValue(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.trim() === "") {
    return "";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Convert a `<input type="datetime-local">` value into an ISO 8601 UTC timestamp. */
export function fromLocalDateTimeValue(local: string): string | null {
  const trimmed = local.trim();
  if (trimmed === "") {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const expiryPresets = [
  { label: "+2h", hours: 2 },
  { label: "+8h", hours: 8 },
  { label: "+24h", hours: 24 },
  { label: "+7d", hours: 168 },
] as const;

export function presetLocalDateTime(hours: number, nowMs = Date.now()): string {
  return toLocalDateTimeValue(
    new Date(nowMs + hours * 3_600_000).toISOString(),
  );
}

/** Group replies into two-level threads (top-level + nested children). */
export function groupForumReplies<
  TReply extends { id: string; parentReplyId: string | null },
>(replies: readonly TReply[]) {
  const topLevel: TReply[] = [];
  const childrenByParent = new Map<string, TReply[]>();
  for (const reply of replies) {
    if (reply.parentReplyId === null) {
      topLevel.push(reply);
      continue;
    }
    const bucket = childrenByParent.get(reply.parentReplyId);
    if (bucket === undefined) {
      childrenByParent.set(reply.parentReplyId, [reply]);
    } else {
      bucket.push(reply);
    }
  }
  return { topLevel, childrenByParent };
}

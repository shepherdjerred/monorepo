import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";
import type { ExploreMessage, ExploreQuotaSnapshot } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * One empty transcript, shared by every render that has no conversation.
 *
 * `?? []` reads as free, but it mints a new array identity on every render,
 * and callers put `messages` (and values derived from it) in effect
 * dependency arrays. A fresh identity every render makes those effects fire
 * every render — which is how Explore's follow-the-stream effect ended up
 * scrolling the page on renders that had nothing to do with new content.
 */
const NO_MESSAGES: ExploreMessage[] = [];
const NO_QUOTA: ExploreQuotaSnapshot[] = [];

export function useExploreConversation(conversationId: string | null) {
  const trpc = useTRPC();
  const statusQuery = useQuery(trpc.explore.status.queryOptions());
  // `strict` because `enabled` is the authorization for this page: a stale
  // `enabled: true` read through `getOrElse` would keep the owner-only
  // transcript on screen precisely when Scout could not reverify guild
  // membership. Collapsing `degraded` to `error` makes the recheck failure
  // close the page instead of failing open.
  const status = Loaded.strict(
    Loaded.fromQuery(statusQuery, ["explore.status"]),
  );
  const availability = Loaded.getOrElse(status, undefined);
  const enabled = availability?.enabled === true;
  const transcript = useQuery({
    ...trpc.explore.get.queryOptions({ conversationId: conversationId ?? "" }),
    enabled: enabled && conversationId !== null,
  });

  // The transcript is the owner-only content the status check guards, so it is
  // `strict` for the same reason the check is: a retained conversation must not
  // outlive the authorization that produced it.
  const conversationState = Loaded.strict(
    Loaded.fromQuery(transcript, ["explore.get"]),
  );
  const conversation = Loaded.getOrElse(conversationState, undefined);
  return {
    status,
    conversationState,
    statusQuery,
    enabled,
    quota: availability?.quota ?? NO_QUOTA,
    transcript,
    messages: conversation?.messages ?? NO_MESSAGES,
    title: conversation?.conversation.title ?? "Explore",
    origin: conversation?.conversation.origin ?? null,
    shared: conversation?.conversation.shareToken ?? null,
  };
}

import { Loaded } from "@shepherdjerred/loaded";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

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
    quota: availability?.quota ?? [],
    transcript,
    messages: conversation?.messages ?? [],
    title: conversation?.conversation.title ?? "Explore",
    shared: conversation?.conversation.shareToken ?? null,
  };
}

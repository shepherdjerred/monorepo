import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { syncAnalyticsIdentity } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { SESSION_QUERY_OPTIONS } from "#src/lib/api/session-query.ts";

/**
 * Keep PostHog's identity in step with the web session, on every route.
 *
 * This belongs at the router root, not in `RequireSession`. `/login` is mounted
 * as a sibling of that guard, so the guard only ever renders for people who
 * still have a session — precisely the people who do not need resetting. A
 * visitor whose cookie expired lands on the public login page, which the guard
 * never renders, so their events stayed attributed to the previous account and
 * signing in as someone else merged the two people.
 *
 * This hook only reports what the session query says; every decision about what
 * to do with that lives in `syncAnalyticsIdentity`, which is where the rules are
 * documented and tested.
 */
export function useAnalyticsIdentity(): {
  sessionResolved: boolean;
  username: string | undefined;
} {
  const trpc = useTRPC();
  // Same query key as the session guard, so React Query serves both from one
  // request rather than asking the server twice per navigation.
  const { data, isSuccess } = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, SESSION_QUERY_OPTIONS),
  );

  // `isSuccess` — not `!isLoading`. It is the only flag that means the server
  // actually answered: a failed query also stops loading after retries are
  // exhausted, but that failure is still not a confirmed signed-out session.
  const analyticsUserId = data?.user?.analyticsUserId;
  useEffect(() => {
    syncAnalyticsIdentity({ sessionResolved: isSuccess, analyticsUserId });
  }, [analyticsUserId, isSuccess]);

  // The caller gates the first capture on this: until the session has answered,
  // any event would be attributed to whoever PostHog still has persisted.
  return { sessionResolved: isSuccess, username: data?.user?.username };
}

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { identifyUser, resetIdentity } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";

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
 * `identifyUser` is idempotent per id and `resetIdentity` no-ops unless PostHog
 * still holds an identity, so running this on every route is cheap and does not
 * churn an anonymous visitor's distinct id.
 */
export function useAnalyticsIdentity(): void {
  const trpc = useTRPC();
  // Same query key as the session guard, so React Query serves both from one
  // request rather than asking the server twice per navigation.
  const { data, isLoading } = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, { retry: false }),
  );

  const analyticsUserId = data?.user?.analyticsUserId;
  useEffect(() => {
    // In flight the id is undefined but unknown, not anonymous; resetting here
    // would fire on every cold page load.
    if (isLoading) return;
    if (analyticsUserId === undefined) {
      resetIdentity();
      return;
    }
    identifyUser(analyticsUserId);
  }, [analyticsUserId, isLoading]);
}

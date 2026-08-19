import { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { useTRPC } from "#src/lib/trpc.ts";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";
import { ExploreRunsProvider } from "#src/components/explore-runs-provider.tsx";
import {
  resolveSessionGuardState,
  SESSION_QUERY_OPTIONS,
} from "#src/lib/session-query.ts";

/**
 * Route guard that redirects to /login if the user has no valid web
 * session cookie. Used as the parent route for everything except /login.
 */
export function RequireSession() {
  const trpc = useTRPC();
  const location = useLocation();
  // sessionState answers `{ user: null }` when signed out instead of throwing,
  // so a normal anonymous visit no longer manufactures a server-side error.
  const { data, failureCount, isError, refetch } = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, SESSION_QUERY_OPTIONS),
  );
  const guardState = resolveSessionGuardState(data, isError);

  if (guardState === "loading") {
    return (
      <LoadingState
        label={failureCount > 0 ? "Reconnecting to Scout…" : "Loading…"}
      />
    );
  }

  if (guardState === "unavailable") {
    return (
      <ErrorState
        title="Reconnecting to Scout"
        message="Scout is temporarily unavailable. Your sign-in is still intact, and this page will retry automatically."
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (guardState === "anonymous") {
    // location.pathname is relative to the BrowserRouter basename (/app),
    // so we re-prefix it before handing to the server. Without the
    // prefix, the backend's safeReturnTo guard rejects the value and the
    // user lands back at /app/ instead of their original destination.
    const returnTo = `/app${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return (
    <Suspense fallback={<SectionSkeleton />}>
      <ExploreRunsProvider>
        <Outlet />
      </ExploreRunsProvider>
    </Suspense>
  );
}

import { Suspense } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";

/**
 * Route guard that redirects to /login if the user has no valid web
 * session cookie. Used as the parent route for everything except /login.
 */
export function RequireSession() {
  const trpc = useTRPC();
  const location = useLocation();
  // sessionState answers `{ user: null }` when signed out instead of throwing,
  // so a normal anonymous visit no longer manufactures a server-side error.
  const { data, isLoading, isError } = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, { retry: false }),
  );

  if (isLoading) {
    return <div style={{ padding: "2rem" }}>Loading…</div>;
  }

  const user = data?.user ?? null;
  if (isError || user === null) {
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
      <Outlet />
    </Suspense>
  );
}

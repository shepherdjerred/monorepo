import { Suspense, useEffect } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { identifyUser, resetIdentity } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { UserMenu } from "#src/components/user-menu.tsx";
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

  // Every authenticated route renders through this guard, so this is the one
  // place that sees each sign-in. `identifyUser` is idempotent per Discord id.
  //
  // The anonymous branch matters just as much: the sign-out menu is only one of
  // the ways a session ends, and an expired or revoked cookie runs no handler at
  // all. Without this, durable persistence would keep attributing the login page
  // to the previous Discord user, and signing in as someone else would merge the
  // two people. `resetIdentity` no-ops unless PostHog still holds an identity,
  // so an ordinary anonymous visitor keeps their distinct id.
  const discordId = data?.user?.discordId;
  useEffect(() => {
    // While the session query is in flight `discordId` is undefined but unknown,
    // not anonymous; resetting here would fire on every cold page load.
    if (isLoading) return;
    if (discordId === undefined) {
      resetIdentity();
      return;
    }
    identifyUser(discordId);
  }, [discordId, isLoading]);

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
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-semibold tracking-tight">
              Scout
            </Link>
            <Link
              to="/"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Guilds
            </Link>
          </div>
          <UserMenu username={user.username} />
        </div>
      </header>
      <main className="flex-1">
        <Suspense fallback={<SectionSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

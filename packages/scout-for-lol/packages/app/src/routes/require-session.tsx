import { Bug } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import { ThemeToggle } from "#src/components/ui/theme-toggle.tsx";
import { SUPPORT_URL } from "#src/lib/support.ts";

/**
 * Route guard that redirects to /login if the user has no valid web
 * session cookie. Used as the parent route for everything except /login.
 */
export function RequireSession() {
  const trpc = useTRPC();
  const location = useLocation();
  const { data, isLoading, isError } = useQuery(
    trpc.auth.meWeb.queryOptions(undefined, { retry: false }),
  );

  if (isLoading) {
    return <div style={{ padding: "2rem" }}>Loading…</div>;
  }

  if (isError || data === undefined) {
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
          <Link to="/" className="font-semibold tracking-tight">
            Scout for LoL
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Guilds
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              @{data.username}
            </span>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              title="Report a bug or request a feature"
            >
              <Bug className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Report a bug</span>
            </a>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void logout();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

async function logout() {
  // Always navigate to /app/login, even if the fetch fails — the user
  // expects "Sign out" to land them on the login page regardless.
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } finally {
    globalThis.location.assign("/app/login");
  }
}

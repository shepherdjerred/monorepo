import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";

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
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  return (
    <div
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #ddd",
        }}
      >
        <strong>Scout for LoL — Manage</strong>
        <div>
          Signed in as <strong>{data.username}</strong> ·{" "}
          <a href="/app/" style={{ marginRight: "0.5rem" }}>
            Guilds
          </a>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main style={{ padding: "1rem", flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}

async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  globalThis.location.assign("/app/login");
}

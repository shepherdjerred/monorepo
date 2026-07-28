import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { TRPCProvider, trpcClient } from "#src/lib/trpc.ts";
import { queryClient } from "#src/lib/query-client.ts";
import { createAppRouter } from "#src/router.tsx";
import { ThemeProvider } from "#src/lib/use-theme.tsx";
import { initAnalytics } from "#src/lib/analytics.ts";
import "#src/styles/global.css";

// VITE_SENTRY_RELEASE is injected at build time by the CI site-deploy step
// (2.0.0-<build>). Guard the untyped env access so `release` stays
// `string | undefined`, never `any`.
const sentryRelease =
  typeof import.meta.env.VITE_SENTRY_RELEASE === "string"
    ? import.meta.env.VITE_SENTRY_RELEASE
    : undefined;

Sentry.init({
  dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
  release: sentryRelease,
  environment: import.meta.env.MODE,
  // Bugsink is Sentry-compatible but does not support performance tracing.
  tracesSampleRate: 0,
  // Monaco/VS Code CancellationError on unmount/nav — not app bugs.
  ignoreErrors: [
    /^Canceled$/,
    /^Cancelled$/,
    /^AbortError$/,
    /^The operation was aborted\.?$/,
  ],
});

// Product-usage analytics (self-hosted Plausible). No-op unless the site build
// injected VITE_PLAUSIBLE_DOMAIN (prod/beta only) — see lib/analytics.ts.
initAnalytics();

// Recover from a stale dynamic-import chunk after a deploy. A still-open tab can
// reference a content-hashed chunk that a later deploy has aged out; Vite fires
// `vite:preloadError` when such an import fails. Reload once to pull the fresh
// shell + chunk graph, guarded by a short timestamp window so a genuinely broken
// chunk can't cause a reload loop. (The deploy keeps old hashes for a grace
// period so most stale imports still resolve — this is the last resort.)
const PRELOAD_RELOAD_KEY = "scout:preload-reloaded-at";
globalThis.addEventListener("vite:preloadError", () => {
  const lastReload = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? "0");
  if (Date.now() - lastReload < 10_000) {
    return; // already reloaded moments ago — the chunk is gone for good, stop.
  }
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  Sentry.captureMessage(
    "vite:preloadError — reloading to recover a stale chunk after deploy",
    "warning",
  );
  globalThis.location.reload();
});

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Missing #root mount point in index.html");
}

const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <RouterProvider router={router} />
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

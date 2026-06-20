import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { App } from "#src/app.tsx";
import { TRPCProvider, trpcClient } from "#src/lib/trpc.ts";
import { ThemeProvider } from "#src/lib/use-theme.tsx";
import "#src/styles/global.css";

// VITE_SENTRY_RELEASE is injected at build time by the CI site-deploy step
// (2.0.0-<build>). Guard the untyped env access so `release` stays
// `string | undefined`, never `any`.
const sentryRelease =
  typeof import.meta.env["VITE_SENTRY_RELEASE"] === "string"
    ? import.meta.env["VITE_SENTRY_RELEASE"]
    : undefined;

Sentry.init({
  dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
  release: sentryRelease,
  environment: import.meta.env.MODE,
  // Bugsink is Sentry-compatible but does not support performance tracing.
  tracesSampleRate: 0,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Missing #root mount point in index.html");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <BrowserRouter basename="/app">
            <App />
          </BrowserRouter>
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

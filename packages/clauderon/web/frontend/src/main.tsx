import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { PropsWithChildren, ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./assets/fonts.css";
import { App } from "./app.tsx";
import { getSentryDsn } from "./config.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

// Workaround: @sentry/react ErrorBoundary types are incompatible with React 19's
// stricter class component typing. The component works at runtime; this cast
// satisfies the type checker.
// eslint-disable-next-line custom-rules/no-type-assertions -- Sentry ErrorBoundary class types incompatible with React 19
const ErrorBoundary = Sentry.ErrorBoundary as unknown as React.ComponentType<
  PropsWithChildren<{ fallback: ReactNode }>
>;

// Initialize Sentry for error reporting (DSN is configured at build time)
const sentryDsn = getSentryDsn();
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
  });
}

const root = document.querySelector("#root");

if (root == null) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<p>An error occurred.</p>}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

import * as Sentry from "@sentry/react";
import { bugsinkBrowserOptions } from "@shepherdjerred/bugsink-config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";

export type MountGameAppOptions = {
  /** The game's Bugsink project DSN. */
  readonly bugsinkDsn: string;
  readonly app: React.ReactNode;
};

/**
 * Boot a game's web UI: error reporting, the react-query client, and the
 * React root on `#root`.
 */
export function mountGameApp({ bugsinkDsn, app }: MountGameAppOptions): void {
  // Vite substitutes these in the game's own build; the release is unset
  // locally, so it is passed through as whatever the build provided.
  const release: unknown = import.meta.env["VITE_BUGSINK_RELEASE"];
  Sentry.init(
    bugsinkBrowserOptions({
      dsn: bugsinkDsn,
      release,
      environment: import.meta.env.MODE,
    }),
  );

  const queryClient = new QueryClient();

  const rootElement = document.querySelector("#root");
  if (rootElement === null) {
    throw new Error("Root element #root not found in document");
  }
  // The HOC form rather than <Sentry.ErrorBoundary>: the class component's
  // types do not satisfy React 19's JSX element checks.
  const GuardedApp = Sentry.withErrorBoundary(
    () => <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>,
    { fallback: <p>An error occurred</p> },
  );
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <GuardedApp />
    </React.StrictMode>,
  );
}

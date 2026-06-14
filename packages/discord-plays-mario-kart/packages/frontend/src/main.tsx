import * as Sentry from "@sentry/react";
import type { ErrorBoundaryProps } from "@sentry/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app.tsx";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Workaround: @sentry/react ErrorBoundary types are incompatible with React 19's
// stricter class component typing. Cast to ComponentType to avoid JSX type errors.
// eslint-disable-next-line custom-rules/no-type-assertions -- Sentry ErrorBoundary class types incompatible with React 19
const ErrorBoundary = Sentry.ErrorBoundary as unknown as React.ComponentType<
  ErrorBoundaryProps & { children: React.ReactNode }
>;

Sentry.init({
  dsn: "https://9c905c2bb5924e55b4dea32e2a95f0d1@bugsink.sjer.red/8",
  environment: import.meta.env.MODE,
});

const queryClient = new QueryClient();

const rootElement = document.querySelector("#root");
if (rootElement === null) {
  throw new Error("Root element #root not found in document");
}
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<p>An error occurred</p>}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

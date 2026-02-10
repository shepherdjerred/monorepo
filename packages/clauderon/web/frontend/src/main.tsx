import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import "./assets/fonts.css";
import { App } from "./App.tsx";
import { SENTRY_DSN } from "./config.ts";

// Initialize Sentry for error reporting (DSN is configured at build time)
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
  });
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error occurred.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);

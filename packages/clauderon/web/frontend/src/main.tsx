import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import "./index.css";
import "./assets/fonts.css";
import { App } from "./app.tsx";
import { getSentryDsn } from "./config.ts";

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
    <Sentry.ErrorBoundary fallback={<p>An error occurred.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);

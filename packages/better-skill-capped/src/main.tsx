import React from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./components/app.tsx";
import { migrateStorage } from "./storage/migrate.ts";
import "#styles/globals.css";

// VITE_SENTRY_RELEASE is not currently injected for this package (the deploy
// entry has no buildEnvVars), so release is undefined until that changes.
// Guard the untyped env access so `release` is `string | undefined`.
const sentryRelease =
  typeof import.meta.env.VITE_SENTRY_RELEASE === "string"
    ? import.meta.env.VITE_SENTRY_RELEASE
    : undefined;

Sentry.init({
  dsn: "https://34fcb766ca0f49499b001635c5cc5cb2@bugsink.sjer.red/3",
  release: sentryRelease,
  environment: import.meta.env.MODE,
});

// One-time localStorage migration (legacy caches and v1 bookmark/watch-status
// shapes) must complete before anything reads the stores. It runs on
// `safeStorage`, so a browser that blocks or has exhausted site storage cannot
// throw here and leave the page blank before React ever mounts.
migrateStorage();

const container = document.querySelector("#root");
if (!container) {
  throw new Error("Root element not found");
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./components/app";
import "./bulma.sass";
import * as Sentry from "@sentry/react";

// Set up dark mode based on system preference
function setupTheme() {
  const prefersDark = globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
}

// Initial setup
setupTheme();

// Listen for system theme changes
globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setupTheme);

Sentry.init({
  dsn: "https://34fcb766ca0f49499b001635c5cc5cb2@bugsink.sjer.red/3",
  // release: process.env.REACT_APP_TRAVIS_COMMIT,
  // environment: process.env.NODE_ENV,
});

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

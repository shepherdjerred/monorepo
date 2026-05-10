import * as Sentry from "@sentry/browser";
import { mountApp } from "./app/app.ts";

Sentry.init({
  dsn: import.meta.env["VITE_SENTRY_DSN"],
  enabled: Boolean(import.meta.env["VITE_SENTRY_DSN"]),
});

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("Missing #app root.");
}

void mountApp(root);

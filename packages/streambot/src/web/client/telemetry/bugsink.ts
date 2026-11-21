import * as Sentry from "@sentry/react";
import { bugsinkBrowserOptions } from "@shepherdjerred/bugsink-config";
import { lastApiReference } from "@shepherdjerred/streambot/web/client/api.ts";
import { scrubBreadcrumb, scrubErrorEvent } from "./scrub.ts";

let started = false;

/**
 * Starts browser error reporting with the DSN `/api/me` hands out (the server's own Bugsink
 * project). Called once after sign-in; errors before sign-in are not reported. Independent of the
 * analytics flag and of Do Not Track: an error report carries no identity.
 */
export function startErrorReporting(dsn: string): void {
  if (started) return;
  started = true;
  Sentry.init({
    ...bugsinkBrowserOptions({
      dsn,
      release: import.meta.env["VITE_BUGSINK_RELEASE"],
      environment: import.meta.env.MODE,
    }),
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) =>
      scrubErrorEvent(event, lastApiReference(), location.origin),
  });
}

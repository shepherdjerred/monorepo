import * as Sentry from "@sentry/react";
import { bugsinkBrowserOptions } from "@shepherdjerred/bugsink-config";
import { lastApiReference } from "@shepherdjerred/streambot/web/client/api.ts";
import { scrubBreadcrumb, scrubErrorEvent } from "./scrub.ts";

let started = false;

/**
 * Starts browser error reporting with what `/api/me` hands out: the server's own Bugsink project,
 * release and environment, so browser and server errors from one deploy group together. Called
 * once after sign-in; errors before sign-in are not reported. Independent of the analytics flag
 * and of Do Not Track: an error report carries no identity.
 */
export function startErrorReporting(bugsink: {
  readonly dsn: string;
  readonly release: string | null;
  readonly environment: string;
}): void {
  if (started) return;
  started = true;
  Sentry.init({
    ...bugsinkBrowserOptions({
      dsn: bugsink.dsn,
      release: bugsink.release,
      environment: bugsink.environment,
    }),
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event) =>
      scrubErrorEvent(event, lastApiReference(), location.origin),
  });
}

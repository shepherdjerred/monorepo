// trmnl-dashboard runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun`
// — `@sentry/node` silently fails to ship events under Bun.
import * as Sentry from "@sentry/bun";
import { bugsinkServerOptions } from "@shepherdjerred/bugsink-config/server";

/**
 * Initialize Bugsink error reporting. No-op when BUGSINK_DSN is unset (local
 * dev). VERSION is baked into the image and ENVIRONMENT is provided by the
 * homelab deployment; both surface as the Bugsink release/environment.
 */
export function initializeBugsink(): void {
  const dsn = Bun.env["BUGSINK_DSN"];
  if (dsn === undefined || dsn === "") {
    console.log("Bugsink disabled: BUGSINK_DSN not set");
    return;
  }

  Sentry.init({
    ...bugsinkServerOptions({
      dsn,
      environment: Bun.env["ENVIRONMENT"] ?? "production",
      release: Bun.env["VERSION"],
    }),
    // Bugsink does not support performance tracing.
    tracesSampleRate: 0,
  });
}

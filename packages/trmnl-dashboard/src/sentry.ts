// trmnl-dashboard runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun`
// — `@sentry/node` silently fails to ship events under Bun.
import * as Sentry from "@sentry/bun";

/**
 * Initialize Sentry error reporting. No-op when SENTRY_DSN is unset (local
 * dev). VERSION is baked into the image and ENVIRONMENT is provided by the
 * homelab deployment; both surface as the Sentry release/environment.
 */
export function initializeSentry(): void {
  const dsn = Bun.env["SENTRY_DSN"];
  if (dsn === undefined || dsn === "") {
    return;
  }

  Sentry.init({
    dsn,
    environment: Bun.env["ENVIRONMENT"] ?? "production",
    release: Bun.env["VERSION"],
    // Bugsink does not support performance tracing.
    tracesSampleRate: 0,
  });
}

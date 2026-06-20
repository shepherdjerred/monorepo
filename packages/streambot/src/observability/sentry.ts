// streambot runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun` —
// the SDK that uses Bun's native fetch transport. `@sentry/node` installs
// Node HTTP-module hooks that silently fail under Bun, so events are queued
// but never POSTed to Bugsink.
import * as Sentry from "@sentry/bun";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("observability:sentry");

/**
 * Initialize Sentry error reporting. No-op when SENTRY_DSN is unset (local
 * dev). VERSION is baked into the image (buildImageHelper) and ENVIRONMENT is
 * provided by the homelab deployment; both surface as the Sentry
 * release/environment so issues are attributable to a deploy.
 */
export function initializeSentry(): void {
  const dsn = Bun.env["SENTRY_DSN"];
  if (dsn === undefined || dsn === "") {
    log.info("Sentry disabled: SENTRY_DSN not set");
    return;
  }

  Sentry.init({
    dsn,
    environment: Bun.env["ENVIRONMENT"] ?? "production",
    release: Bun.env["VERSION"],
    // Bugsink does not support performance tracing.
    tracesSampleRate: 0,
  });

  log.info("Sentry initialized");
}

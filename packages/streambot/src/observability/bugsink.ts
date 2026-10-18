// streambot runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun` —
// the SDK that uses Bun's native fetch transport. `@sentry/node` installs
// Node HTTP-module hooks that silently fail under Bun, so events are queued
// but never POSTed to Bugsink.
import * as Sentry from "@sentry/bun";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("observability:bugsink");

/**
 * Initialize Bugsink error reporting. No-op when BUGSINK_DSN is unset (local
 * dev). VERSION is baked into the image (buildImageHelper) and ENVIRONMENT is
 * provided by the homelab deployment; both surface as the Bugsink
 * release/environment so issues are attributable to a deploy.
 */
export function initializeBugsink(): void {
  const dsn = Bun.env["BUGSINK_DSN"];
  if (dsn === undefined || dsn === "") {
    log.info("Bugsink disabled: BUGSINK_DSN not set");
    return;
  }

  Sentry.init({
    dataCollection: bugsinkDataCollection(),
    dsn,
    environment: Bun.env["ENVIRONMENT"] ?? "production",
    release: Bun.env["VERSION"],
    // Streambot owns the global OpenTelemetry providers so its manually bounded voice spans and
    // OTLP logs reach Tempo and Loki. The Sentry SDK remains the error-only Bugsink client.
    enableOpenTelemetrySetup: false,
    // Bugsink does not support performance tracing.
    tracesSampleRate: 0,
  });

  log.info("Bugsink initialized");
}

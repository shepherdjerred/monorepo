// streambot runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun` —
// the SDK that uses Bun's native fetch transport. `@sentry/node` installs
// Node HTTP-module hooks that silently fail under Bun, so events are queued
// but never POSTed to Bugsink.
import * as Sentry from "@sentry/bun";
import { bugsinkServerOptions } from "@shepherdjerred/bugsink-config/server";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("observability:bugsink");

/** The project, release and environment Streambot reports errors under. */
export type BugsinkReporting = {
  readonly dsn: string;
  readonly release: string | null;
  readonly environment: string;
};

/**
 * The public Bugsink host. Every first-party browser app (discord-plays, Scout, sjer.red) reports
 * to a DSN on this host; a DSN anywhere else is cluster-internal and must not reach a browser.
 */
export const PUBLIC_BUGSINK_HOST = "bugsink.sjer.red";

/**
 * What a browser may report with: the server's own reporting, but only when its DSN is an
 * `https:` URL on the public Bugsink host. An internal, plain-HTTP or malformed DSN yields `null`,
 * so the browser reports nothing rather than learning a cluster address.
 */
export function browserBugsink(
  reporting: BugsinkReporting | null,
): BugsinkReporting | null {
  if (reporting === null) return null;
  let url: URL;
  try {
    url = new URL(reporting.dsn);
  } catch {
    return null;
  }
  return url.protocol === "https:" &&
    url.hostname === PUBLIC_BUGSINK_HOST &&
    url.port === ""
    ? reporting
    : null;
}

/**
 * Initialize Bugsink error reporting. No-op when BUGSINK_DSN is unset (local
 * dev). VERSION is baked into the image (buildImageHelper) and ENVIRONMENT is
 * provided by the homelab deployment; both surface as the Bugsink
 * release/environment so issues are attributable to a deploy.
 *
 * Returns what it initialised with, or `null` when disabled, so the web remote can hand the same
 * project, release and environment to signed-in browsers (see `browserBugsink`). This is the one
 * place the DSN is read; the value itself is never logged.
 */
export function initializeBugsink(): BugsinkReporting | null {
  const dsn = Bun.env["BUGSINK_DSN"];
  if (dsn === undefined || dsn === "") {
    log.info("Bugsink disabled: BUGSINK_DSN not set");
    return null;
  }
  const environment = Bun.env["ENVIRONMENT"] ?? "production";
  const release = Bun.env["VERSION"];

  Sentry.init({
    ...bugsinkServerOptions({ dsn, environment, release }),
    // Streambot owns the global OpenTelemetry providers so its manually bounded voice spans and
    // OTLP logs reach Tempo and Loki. The Sentry SDK remains the error-only Bugsink client.
    enableOpenTelemetrySetup: false,
    // Bugsink does not support performance tracing.
    tracesSampleRate: 0,
  });

  log.info("Bugsink initialized");
  return {
    dsn,
    release: release === undefined || release === "" ? null : release,
    environment,
  };
}

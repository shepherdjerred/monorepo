/** Bugsink setup and the process-level fatal handlers.
 *
 *  Its own module so the startup script can arm monitoring *before* the
 *  database bootstrap. Migrations are the riskiest part of startup, so a
 *  failure there is exactly what needs reporting — but they run before
 *  `src/index.ts` is imported, so initializing Bugsink there would have left
 *  those failures visible only in container logs. */
import * as Sentry from "@sentry/bun";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";
import configuration from "#src/configuration.ts";
import { filterStarlightBugsinkEvent } from "#src/bugsink-filters.ts";

let initialized = false;

/** Idempotent: `scripts/start.ts` arms this first, and `src/index.ts` calls it
 *  again so running the entrypoint directly still gets monitoring. */
export function initObservability(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  Sentry.init({
    dataCollection: bugsinkDataCollection(),
    dsn: configuration.bugsinkDsn,
    environment: configuration.environment,
    release: configuration.gitSha,
    beforeSend: filterStarlightBugsinkEvent,
  });
  console.warn("[App] Bugsink initialized");

  process.on("unhandledRejection", (reason: unknown) => {
    exitOnFatal("unhandledRejection", reason);
  });

  process.on("uncaughtException", (error: unknown) => {
    exitOnFatal("uncaughtException", error);
  });
}

/** Report a fatal error and terminate.
 *
 *  This MUST exit. Installing `unhandledRejection`/`uncaughtException`
 *  listeners suppresses the runtime's default fatal behavior — verified in
 *  Bun: with a log-only handler an unhandled rejection leaves the process
 *  alive and it still exits 0. Reporting and returning would leave the bot
 *  running in an undefined state while the still-connected gateway keeps
 *  `/live` answering 200, so Kubernetes would never recycle it. That is
 *  precisely the zombie the probes exist to catch. */
export function exitOnFatal(source: string, error: unknown): void {
  console.error("[App] fatal error:", source, error);
  Sentry.captureException(error, { tags: { source } });
  void (async () => {
    try {
      // Best-effort flush; the report is lost if the process dies first.
      await Sentry.close(2000);
    } catch (flushError) {
      console.error("[App] Failed to flush Bugsink before exit:", flushError);
    } finally {
      process.exit(1);
    }
  })();
}

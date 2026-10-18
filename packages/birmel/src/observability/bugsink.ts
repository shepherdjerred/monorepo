// Birmel runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun` —
// the matching SDK that uses Bun's native fetch transport. `@sentry/node`
// installs Node's HTTP-module hooks that silently fail under Bun's compat
// layer; events are captured and queued but never actually POSTed to Bugsink.
// Confirmed by comparison with scout-for-lol/backend (working) which also
// runs on Bun and uses @sentry/bun.
import * as Sentry from "@sentry/bun";
import { bugsinkDataCollection } from "@shepherdjerred/bugsink-config";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { filterBirmelBugsinkEvent } from "./bugsink-filters.ts";

let bugsinkInitialized = false;

export function initializeBugsink(): void {
  const config = getConfig();

  if (
    !config.bugsink.enabled ||
    config.bugsink.dsn == null ||
    config.bugsink.dsn.length === 0
  ) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Bugsink disabled or DSN not configured",
        module: "observability.bugsink",
      }),
    );
    return;
  }

  Sentry.init({
    dataCollection: bugsinkDataCollection(),
    dsn: config.bugsink.dsn,
    environment: config.bugsink.environment,
    ...(config.bugsink.release != null && config.bugsink.release.length > 0
      ? { release: config.bugsink.release }
      : {}),
    sampleRate: config.bugsink.sampleRate,
    // Bugsink does not support performance monitoring; keep traces off.
    tracesSampleRate: config.bugsink.tracesSampleRate,
    // Don't let the Sentry SDK register the global TracerProvider/Propagator/ContextManager.
    // Otherwise it lands first (initializeBugsink runs before initializeTracing),
    // and Birmel's later provider registration collides — no spans
    // reach Tempo. The Sentry SDK stays for errors via captureException.
    enableOpenTelemetrySetup: false,
    // When debug is on, the SDK logs its own transport activity to stderr —
    // the only way to see "event sent" / "event dropped" details from
    // @sentry/bun, useful when triaging delivery issues.
    debug: config.bugsink.debug,
    // Surface every captured event in our JSON log stream so we can correlate
    // "we tried to send X" with "Bugsink received Y" without enabling debug.
    // This is intentionally lightweight (no body), runs once per event, and
    // returns the event unchanged so the Sentry SDK's own pipeline is unaffected.
    beforeSend(event, hint) {
      const filtered = filterBirmelBugsinkEvent(event, hint);
      if (filtered === null) {
        return null;
      }
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Bugsink event captured",
          module: "observability.bugsink",
          eventId: filtered.event_id,
          exceptionType: filtered.exception?.values?.[0]?.type,
          release: filtered.release,
          environment: filtered.environment,
        }),
      );
      return filtered;
    },
  });

  bugsinkInitialized = true;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Bugsink initialized",
      module: "observability.bugsink",
      environment: config.bugsink.environment,
      release: config.bugsink.release,
    }),
  );
}

export function isBugsinkEnabled(): boolean {
  return bugsinkInitialized;
}

export type DiscordContext = {
  guildId?: string;
  channelId?: string;
  userId?: string;
  username?: string;
  messageId?: string;
  scheduleId?: string;
  threadId?: string;
};

export function setBugsinkContext(context: DiscordContext): void {
  if (!bugsinkInitialized) {
    return;
  }

  Sentry.setContext("discord", { ...context });

  if (context.userId != null && context.userId.length > 0) {
    Sentry.setUser({
      id: context.userId,
      ...(context.username != null && context.username.length > 0
        ? { username: context.username }
        : {}),
    });
  }
}

export function clearBugsinkContext(): void {
  if (!bugsinkInitialized) {
    return;
  }

  Sentry.setContext("discord", null);
  Sentry.setUser(null);
}

/**
 * Wrap an async function to capture exceptions to Bugsink.
 * Similar pattern to Scout for LoL's logErrors wrapper.
 */
export function logErrors(
  fn: (...args: never[]) => Promise<unknown>,
  operationName?: string,
): (...args: never[]) => Promise<unknown> {
  return async (...args: never[]): Promise<unknown> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (bugsinkInitialized && error instanceof Error) {
        Sentry.captureException(error, {
          tags: {
            operation: operationName ?? fn.name,
          },
        });
      }
      throw error;
    }
  };
}

/**
 * Capture an exception with additional context.
 */
export function captureException(
  error: Error,
  context?: {
    operation?: string;
    discord?: DiscordContext;
    extra?: Record<string, unknown>;
    fingerprint?: string[];
  },
): void {
  if (!bugsinkInitialized) {
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.operation != null && context.operation.length > 0) {
      scope.setTag("operation", context.operation);
    }
    if (context?.discord != null) {
      scope.setContext("discord", { ...context.discord });
    }
    if (context?.extra != null) {
      scope.setExtras(context.extra);
    }
    if (context?.fingerprint != null) {
      scope.setFingerprint(context.fingerprint);
    }
    Sentry.captureException(error);
  });
}

/**
 * Capture a message with a severity level.
 */
export function captureMessage(
  message: string,
  level: "fatal" | "error" | "warning" | "log" | "info" | "debug" = "info",
): void {
  if (!bugsinkInitialized) {
    return;
  }
  Sentry.captureMessage(message, level);
}

/**
 * Flush Bugsink events before shutdown.
 */
export async function flushBugsink(timeout = 2000): Promise<void> {
  if (!bugsinkInitialized) {
    return;
  }
  await Sentry.flush(timeout);
}

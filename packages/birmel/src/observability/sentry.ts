// Birmel runs on Bun (`bun run src/index.ts`), so we use `@sentry/bun` —
// the matching SDK that uses Bun's native fetch transport. `@sentry/node`
// installs Node's HTTP-module hooks that silently fail under Bun's compat
// layer; events are captured and queued but never actually POSTed to Bugsink.
// Confirmed by comparison with scout-for-lol/backend (working) which also
// runs on Bun and uses @sentry/bun.
import * as Sentry from "@sentry/bun";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

let sentryInitialized = false;

export function initializeSentry(): void {
  const config = getConfig();

  if (
    !config.sentry.enabled ||
    config.sentry.dsn == null ||
    config.sentry.dsn.length === 0
  ) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Sentry disabled or DSN not configured",
        module: "observability.sentry",
      }),
    );
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    ...(config.sentry.release != null && config.sentry.release.length > 0
      ? { release: config.sentry.release }
      : {}),
    sampleRate: config.sentry.sampleRate,
    // Bugsink does not support performance monitoring; keep traces off.
    tracesSampleRate: config.sentry.tracesSampleRate,
    // Don't let Sentry register the global TracerProvider/Propagator/ContextManager.
    // Otherwise it lands first (initializeSentry runs before initializeTracing),
    // and VoltAgentObservability's later provider.register() collides — no spans
    // reach Tempo. Sentry stays for errors via captureException.
    skipOpenTelemetrySetup: true,
    // When debug is on, the SDK logs its own transport activity to stderr —
    // the only way to see "event sent" / "event dropped" details from
    // @sentry/bun, useful when triaging delivery issues.
    debug: config.sentry.debug,
    // Surface every captured event in our JSON log stream so we can correlate
    // "we tried to send X" with "Bugsink received Y" without enabling debug.
    // This is intentionally lightweight (no body), runs once per event, and
    // returns the event unchanged so Sentry's own pipeline is unaffected.
    beforeSend(event) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Sentry event captured",
          module: "observability.sentry",
          eventId: event.event_id,
          exceptionType: event.exception?.values?.[0]?.type,
          release: event.release,
          environment: event.environment,
        }),
      );
      return event;
    },
  });

  sentryInitialized = true;

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Sentry initialized",
      module: "observability.sentry",
      environment: config.sentry.environment,
      release: config.sentry.release,
    }),
  );
}

export function isSentryEnabled(): boolean {
  return sentryInitialized;
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

export function setSentryContext(context: DiscordContext): void {
  if (!sentryInitialized) {
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

export function clearSentryContext(): void {
  if (!sentryInitialized) {
    return;
  }

  Sentry.setContext("discord", null);
  Sentry.setUser(null);
}

/**
 * Wrap an async function to capture exceptions to Sentry.
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
      if (sentryInitialized && error instanceof Error) {
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
  if (!sentryInitialized) {
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
  if (!sentryInitialized) {
    return;
  }
  Sentry.captureMessage(message, level);
}

/**
 * Flush Sentry events before shutdown.
 */
export async function flushSentry(timeout = 2000): Promise<void> {
  if (!sentryInitialized) {
    return;
  }
  await Sentry.flush(timeout);
}

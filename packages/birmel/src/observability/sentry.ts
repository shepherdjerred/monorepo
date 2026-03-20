import * as Sentry from "@sentry/node";
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
    tracesSampleRate: config.sentry.tracesSampleRate,
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

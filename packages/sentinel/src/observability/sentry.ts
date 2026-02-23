import * as Sentry from "@sentry/bun";
import { getConfig } from "@shepherdjerred/sentinel/config/index.ts";

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
  });

  sentryInitialized = true;
}

export function captureException(
  error: Error,
  context?: {
    operation?: string;
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
    if (context?.extra != null) {
      scope.setExtras(context.extra);
    }
    Sentry.captureException(error);
  });
}

export async function flushSentry(timeout = 2000): Promise<void> {
  if (!sentryInitialized) {
    return;
  }
  await Sentry.flush(timeout);
}

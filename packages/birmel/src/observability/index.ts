import { initializeSentry, flushSentry } from "./sentry.ts";
import { initializeTracing, shutdownTracing } from "./tracing.ts";

/**
 * Initialize all observability systems (Sentry and OpenTelemetry).
 * Call this early in the application startup, before other imports that might throw.
 */
export function initializeObservability(): void {
  initializeSentry();
  initializeTracing();
}

/**
 * Gracefully shutdown all observability systems.
 * Call this during application shutdown.
 */
export async function shutdownObservability(): Promise<void> {
  await flushSentry();
  await shutdownTracing();
}

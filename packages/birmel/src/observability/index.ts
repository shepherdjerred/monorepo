import { initializeBugsink, flushBugsink } from "./bugsink.ts";
import { initializeTracing, shutdownTracing } from "./tracing.ts";

/**
 * Initialize all observability systems (Bugsink and OpenTelemetry).
 * Call this early in the application startup, before other imports that might throw.
 */
export function initializeObservability(): void {
  initializeBugsink();
  initializeTracing();
}

/**
 * Gracefully shutdown all observability systems.
 * Call this during application shutdown.
 */
export async function shutdownObservability(): Promise<void> {
  await flushBugsink();
  await shutdownTracing();
}

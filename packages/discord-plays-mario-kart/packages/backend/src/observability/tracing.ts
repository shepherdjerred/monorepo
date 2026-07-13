// Mario Kart's tracing setup delegates to the shared discord-plays-core tracer,
// supplying the service name and the winston logger the OTel diagnostics route
// through. (Unlike pokemon it has no llm-observability archive layer, so no
// wrapSpanProcessor hook.)
import {
  initializeTracing as coreInitializeTracing,
  getTracer as coreGetTracer,
  withSpan as coreWithSpan,
  shutdownTracing as coreShutdownTracing,
} from "@shepherdjerred/discord-plays-core/observability/tracing.ts";
import type { Tracer } from "@opentelemetry/api";
import { logger } from "#src/logger.ts";

const DEFAULT_SERVICE_NAME = "discord-plays-mario-kart";

/** The tracer, or undefined when telemetry is disabled. */
export function getTracer(): Tracer | undefined {
  return coreGetTracer();
}

/** Run `fn` inside a span named `name` (no-op passthrough when telemetry is off). */
export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return coreWithSpan(name, fn);
}

export function shutdownTracing(): Promise<void> {
  return coreShutdownTracing();
}

export function initializeTracing(): void {
  coreInitializeTracing({
    serviceName: DEFAULT_SERVICE_NAME,
    logger,
  });
}

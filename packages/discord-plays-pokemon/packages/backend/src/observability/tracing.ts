// Pokémon's tracing setup delegates to the shared discord-plays-core tracer and
// supplies the game-specific pieces: the service name, the winston logger the
// OTel diagnostics route through, and the llm-observability archive layer wrapped
// around the batch span processor (spans carrying gen_ai.* body attributes get
// their bodies gzipped to SeaweedFS and replaced with a ref before the slim span
// reaches Tempo — no-op when LLM_OBSERVABILITY_ENABLED=false; same shape as
// birmel / scout / temporal). The archive dependency stays out of core via the
// wrapSpanProcessor hook.
import { buildArchiveSpanProcessor } from "@shepherdjerred/llm-observability";
import {
  initializeTracing as coreInitializeTracing,
  getTracer as coreGetTracer,
  withSpan as coreWithSpan,
  shutdownTracing as coreShutdownTracing,
} from "@shepherdjerred/discord-plays-core/observability/tracing.ts";
import type { Tracer } from "@opentelemetry/api";
import { logger } from "#src/logger.ts";

const DEFAULT_SERVICE_NAME = "discord-plays-pokemon";

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
    wrapSpanProcessor: (inner) => buildArchiveSpanProcessor({ inner }),
  });
}

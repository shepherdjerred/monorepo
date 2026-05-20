import { type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  LlmArchiveSpanProcessor,
  type ArchiveLogger,
} from "./archive-span-processor.ts";
import {
  loadLlmObservabilityConfig,
  type LlmObservabilityConfig,
} from "./config.ts";

export type BuildArchiveProcessorOptions = {
  /** The processor that the archive layer wraps — typically a BatchSpanProcessor. */
  inner: SpanProcessor;
  /** Pre-loaded config (e.g. for tests). Defaults to `loadLlmObservabilityConfig()`. */
  config?: LlmObservabilityConfig;
  /** Override logger. */
  logger?: ArchiveLogger;
  /** Override random source for sampling — tests. */
  random?: () => number;
};

/**
 * Build the archive-wrapping SpanProcessor. Returns `inner` unchanged when
 * `LLM_OBSERVABILITY_ENABLED=false` — callers can register the result on their
 * TracerProvider unconditionally.
 *
 * Typical usage in a service's `tracing.ts`:
 *
 *   const exporter = new OTLPTraceExporter({ url });
 *   const batch = new BatchSpanProcessor(exporter, {...});
 *   const root = buildArchiveSpanProcessor({ inner: batch });
 *   new NodeSDK({ resource, spanProcessors: [root] }).start();
 */
export function buildArchiveSpanProcessor(
  options: BuildArchiveProcessorOptions,
): SpanProcessor {
  const config = options.config ?? loadLlmObservabilityConfig();
  if (!config.enabled) return options.inner;

  return new LlmArchiveSpanProcessor({
    inner: options.inner,
    archive: config.archive,
    sampleRate: config.sampleRate,
    logger: options.logger,
    random: options.random,
  });
}

import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type { RunRecorder } from "./run-recorder.ts";
import { SpanJsonlProcessor } from "./span-jsonl-processor.ts";

export type FleetTelemetryRuntime = {
  shutdown: () => Promise<void>;
};

export async function createFleetTelemetryRuntime(
  recorder: RunRecorder,
): Promise<FleetTelemetryRuntime> {
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  if (!context.setGlobalContextManager(contextManager)) {
    contextManager.disable();
    throw new Error("OpenTelemetry context manager is already registered");
  }
  const processor = new SpanJsonlProcessor(recorder.paths.spans, (value) =>
    recorder.redact(value),
  );
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "pr-fleet-controller",
      "service.version": recorder.manifest.controllerVersion,
      "service.instance.id": recorder.runId,
    }),
    spanProcessors: [processor],
  });
  if (!trace.setGlobalTracerProvider(provider)) {
    // context.disable() both disables our manager and unregisters it, so the
    // global API falls back to the noop manager instead of delegating to a
    // disabled AsyncLocalStorage (which wedges later context.with callers).
    // The tracer provider is left alone here: this branch means someone
    // else's provider holds the global, and unregistering it would be this
    // failed runtime tearing down a live one.
    context.disable();
    await processor.shutdown();
    throw new Error("OpenTelemetry tracer provider is already registered");
  }
  await recorder.secureRunArtifacts();

  let closed = false;
  return {
    shutdown: async () => {
      if (closed) return;
      closed = true;
      try {
        await provider.shutdown();
      } finally {
        // Unregister BOTH globals rather than merely disabling them. A
        // disabled ALS manager left registered breaks every later
        // context.with caller, and a shut-down tracer provider left
        // registered is worse: `setGlobalTracerProvider` is one-shot, so the
        // next runtime in this process cannot register at all, and every span
        // in the meantime routes into a processor whose target file has
        // already been cleaned up ("Cannot write a span after shutdown").
        trace.disable();
        context.disable();
        await recorder.secureRunArtifacts();
      }
    },
  };
}

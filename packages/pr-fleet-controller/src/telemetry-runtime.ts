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
        // Unregister rather than merely disable: a disabled ALS manager left
        // as the global would break every later context.with caller.
        context.disable();
        await recorder.secureRunArtifacts();
      }
    },
  };
}

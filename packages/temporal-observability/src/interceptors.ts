import { trace, type Tracer } from "@opentelemetry/api";
// Import the client interceptor from its specific subpath rather than the
// package root. The root barrel (`lib/index.js`) eagerly re-exports
// `./workflow`, which patches the Workflow sandbox isolate runtime and pulls
// in @temporalio/interceptors-opentelemetry's own `@opentelemetry/sdk-trace-base`
// (pinned ^1.25.1). That collides with this repo's root `overrides` pin of
// `@opentelemetry/core` to 2.10.0 (sdk-trace-base@1.x expects core@1.x's
// `TracesSamplerValues` export, which core@2.x removed), crashing module load
// in any process — including this one — that imports the bare package name.
// `lib/client` only needs `@opentelemetry/api` and `@temporalio/common`, so
// importing it directly avoids the incompatible transitive chain entirely.
import {
  OpenTelemetryWorkflowClientInterceptor,
  type InterceptorOptions,
} from "@temporalio/interceptors-opentelemetry/lib/client/index.js";
import {
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
} from "@temporalio/interceptors-opentelemetry/lib/worker/index.js";
import type { Context as ActivityContext } from "@temporalio/activity";
import type {
  ActivityInterceptorsFactory,
  InjectedSink,
} from "@temporalio/worker";
import type { Sink } from "@temporalio/workflow";

const INSTRUMENTATION_NAME = "@shepherdjerred/temporal-observability";

export type TemporalWorkflowExporterSink = Sink & {
  export: (spans: unknown) => void;
};

export type TemporalWorkflowSpanContext = {
  exporter: InjectedSink<TemporalWorkflowExporterSink>;
};

function interceptorOptions(tracer: Tracer): InterceptorOptions {
  return { tracer };
}

export function createTemporalClientTracingInterceptor(
  tracer: Tracer = trace.getTracer(INSTRUMENTATION_NAME),
): OpenTelemetryWorkflowClientInterceptor {
  return new OpenTelemetryWorkflowClientInterceptor(interceptorOptions(tracer));
}

function createActivityInterceptors(
  tracer: Tracer,
): ActivityInterceptorsFactory {
  return (context: ActivityContext) => ({
    inbound: new OpenTelemetryActivityInboundInterceptor(
      context,
      interceptorOptions(tracer),
    ),
    outbound: new OpenTelemetryActivityOutboundInterceptor(context),
  });
}

export function temporalWorkflowTracingModulePath(): string {
  return new URL(
    import.meta.resolve("@temporalio/interceptors-opentelemetry/lib/workflow"),
  ).pathname;
}

export function createTemporalWorkerTracing(
  workflowSinks: TemporalWorkflowSpanContext,
  tracer: Tracer = trace.getTracer(INSTRUMENTATION_NAME),
): {
  readonly activity: ActivityInterceptorsFactory[];
  readonly workflowModules: string[];
  readonly sinks: TemporalWorkflowSpanContext;
} {
  return {
    activity: [createActivityInterceptors(tracer)],
    workflowModules: [temporalWorkflowTracingModulePath()],
    sinks: workflowSinks,
  };
}

import { trace, type Tracer } from "@opentelemetry/api";
import {
  OpenTelemetryWorkflowClientInterceptor,
  type InterceptorOptions,
} from "@temporalio/interceptors-opentelemetry";
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

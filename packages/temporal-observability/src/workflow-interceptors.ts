import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryInternalsInterceptor,
  OpenTelemetryOutboundInterceptor,
} from "@temporalio/interceptors-opentelemetry-v2/lib/workflow/index.js";
import type { WorkflowInterceptorsFactory } from "@temporalio/workflow";

// The SDK module exports classes; Worker workflowModules require a factory.
// Load this entrypoint only inside the Workflow sandbox.
export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
  internals: [new OpenTelemetryInternalsInterceptor()],
});

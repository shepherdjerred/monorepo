import {
  createTraceState,
  type Attributes,
  type Link,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import type {
  ReadableSpan,
  SpanProcessor,
  TimedEvent,
} from "@opentelemetry/sdk-trace-base";
import type { InjectedSink } from "@temporalio/worker";
import type { WorkflowInfo } from "@temporalio/workflow";
import { z } from "zod";
import type { TemporalWorkflowExporterSink } from "./interceptors.ts";

const HexSchema = (length: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${String(length)}}$`, "u"));
const HrTimeSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().min(0).max(999_999_999),
]);
const AttributeValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.array(z.string()),
  z.array(z.boolean()),
  z.array(z.number()),
]);
const AttributesSchema = z.record(z.string(), AttributeValueSchema);
const SpanContextSchema = z.object({
  traceId: HexSchema(32),
  spanId: HexSchema(16),
  traceFlags: z.number().int().min(0).max(255),
  traceState: z.string().optional(),
  isRemote: z.boolean().optional(),
});
const LinkSchema = z.object({
  context: SpanContextSchema,
  attributes: AttributesSchema.optional(),
  droppedAttributesCount: z.number().int().nonnegative().optional(),
});
const TimedEventSchema = z.object({
  name: z.string(),
  time: HrTimeSchema,
  attributes: AttributesSchema.optional(),
  droppedAttributesCount: z.number().int().nonnegative().optional(),
});

const WorkflowSpanSchema = z.object({
  name: z.string().min(1),
  kind: z.number().int().min(0).max(4),
  spanContext: SpanContextSchema,
  parentSpanId: HexSchema(16).optional(),
  startTime: HrTimeSchema,
  endTime: HrTimeSchema,
  status: z.object({
    code: z.number().int().min(0).max(2),
    message: z.string().optional(),
  }),
  attributes: AttributesSchema,
  links: z.array(LinkSchema),
  events: z.array(TimedEventSchema),
  duration: HrTimeSchema,
  ended: z.boolean(),
  droppedAttributesCount: z.number().int().nonnegative(),
  droppedLinksCount: z.number().int().nonnegative(),
  droppedEventsCount: z.number().int().nonnegative(),
  instrumentationLibrary: z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    schemaUrl: z.string().optional(),
  }),
});

export const WorkflowSpanBatchSchema = z.array(WorkflowSpanSchema).min(1);

type ValidatedWorkflowSpan = z.infer<typeof WorkflowSpanSchema>;

function toSpanContext(
  value: ValidatedWorkflowSpan["spanContext"],
): SpanContext {
  return {
    traceId: value.traceId,
    spanId: value.spanId,
    traceFlags: value.traceFlags,
    ...(value.traceState === undefined
      ? {}
      : { traceState: createTraceState(value.traceState) }),
    ...(value.isRemote === undefined ? {} : { isRemote: value.isRemote }),
  };
}

function toAttributes(value: ValidatedWorkflowSpan["attributes"]): Attributes {
  return value;
}

function toSpanKind(value: number): SpanKind {
  switch (value) {
    case 0:
      return SpanKind.INTERNAL;
    case 1:
      return SpanKind.SERVER;
    case 2:
      return SpanKind.CLIENT;
    case 3:
      return SpanKind.PRODUCER;
    case 4:
      return SpanKind.CONSUMER;
    default:
      throw new Error(`Unsupported span kind: ${String(value)}`);
  }
}

function toSpanStatus(value: ValidatedWorkflowSpan["status"]): {
  code: SpanStatusCode;
  message?: string;
} {
  let code: SpanStatusCode;
  switch (value.code) {
    case 0:
      code = SpanStatusCode.UNSET;
      break;
    case 1:
      code = SpanStatusCode.OK;
      break;
    case 2:
      code = SpanStatusCode.ERROR;
      break;
    default:
      throw new Error(`Unsupported span status code: ${String(value.code)}`);
  }
  return value.message === undefined
    ? { code }
    : { code, message: value.message };
}

function toLinks(value: ValidatedWorkflowSpan["links"]): Link[] {
  return value.map((link) => ({
    context: toSpanContext(link.context),
    ...(link.attributes === undefined
      ? {}
      : { attributes: toAttributes(link.attributes) }),
    ...(link.droppedAttributesCount === undefined
      ? {}
      : { droppedAttributesCount: link.droppedAttributesCount }),
  }));
}

function toEvents(value: ValidatedWorkflowSpan["events"]): TimedEvent[] {
  return value.map((event) => ({
    name: event.name,
    time: event.time,
    ...(event.attributes === undefined
      ? {}
      : { attributes: toAttributes(event.attributes) }),
    ...(event.droppedAttributesCount === undefined
      ? {}
      : { droppedAttributesCount: event.droppedAttributesCount }),
  }));
}

type WorkflowSpanInfo = Pick<
  WorkflowInfo,
  "namespace" | "taskQueue" | "workflowId" | "runId" | "workflowType"
>;

function workflowAttributes(info: WorkflowSpanInfo): Attributes {
  return {
    "temporal.namespace": info.namespace,
    "temporal.task_queue": info.taskQueue,
    "temporal.workflow_id": info.workflowId,
    "temporal.run_id": info.runId,
    "temporal.workflow_type": info.workflowType,
  };
}

function instrumentationScope(
  value: ValidatedWorkflowSpan["instrumentationLibrary"],
): { name: string; version?: string; schemaUrl?: string } {
  return {
    name: value.name,
    ...(value.version === undefined ? {} : { version: value.version }),
    ...(value.schemaUrl === undefined ? {} : { schemaUrl: value.schemaUrl }),
  };
}

function toReadableSpan(
  span: ValidatedWorkflowSpan,
  info: WorkflowSpanInfo,
  resource: Resource,
): ReadableSpan {
  const spanContext = toSpanContext(span.spanContext);
  const parentSpanContext =
    span.parentSpanId === undefined
      ? undefined
      : {
          traceId: span.spanContext.traceId,
          spanId: span.parentSpanId,
          traceFlags: span.spanContext.traceFlags,
          ...(span.spanContext.traceState === undefined
            ? {}
            : {
                traceState: createTraceState(span.spanContext.traceState),
              }),
          isRemote: false,
        };
  return {
    name: span.name,
    kind: toSpanKind(span.kind),
    spanContext: () => spanContext,
    ...(parentSpanContext === undefined ? {} : { parentSpanContext }),
    startTime: span.startTime,
    endTime: span.endTime,
    status: toSpanStatus(span.status),
    attributes: {
      ...toAttributes(span.attributes),
      ...workflowAttributes(info),
    },
    links: toLinks(span.links),
    events: toEvents(span.events),
    duration: span.duration,
    ended: span.ended,
    resource,
    instrumentationScope: instrumentationScope(span.instrumentationLibrary),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedLinksCount: span.droppedLinksCount,
    droppedEventsCount: span.droppedEventsCount,
  };
}

export function createValidatedWorkflowSpanSink(
  processor: SpanProcessor,
  resource: Resource,
): InjectedSink<TemporalWorkflowExporterSink> {
  return {
    export: {
      callDuringReplay: false,
      fn(info, spans) {
        forwardValidatedWorkflowSpans(processor, resource, info, spans);
      },
    },
  };
}

export function forwardValidatedWorkflowSpans(
  processor: SpanProcessor,
  resource: Resource,
  info: WorkflowSpanInfo,
  spans: unknown,
): void {
  const validated = WorkflowSpanBatchSchema.parse(spans);
  for (const span of validated) {
    processor.onEnd(toReadableSpan(span, info, resource));
  }
}

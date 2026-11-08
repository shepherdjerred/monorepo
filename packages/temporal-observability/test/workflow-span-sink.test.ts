import { describe, expect, test } from "vitest";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  createValidatedWorkflowSpanSink,
  forwardValidatedWorkflowSpans,
} from "@shepherdjerred/temporal-observability/workflow-span-sink";
import type { SerializableSpan } from "@temporalio/interceptors-opentelemetry-v2/lib/workflow/index.js";

const WORKFLOW_INFO = {
  namespace: "prod",
  taskQueue: "monorepo-workflows",
  workflowId: "workflow-1",
  runId: "run-1",
  workflowType: "exampleWorkflow",
};

function span(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const valid = {
    name: "RunWorkflow:exampleWorkflow",
    kind: SpanKind.SERVER,
    spanContext: {
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
      traceFlags: 1,
    },
    parentSpanContext: {
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "fedcba9876543210",
      traceFlags: 1,
      traceState: "vendor=parent",
      isRemote: true,
    },
    startTime: [1, 0],
    endTime: [2, 0],
    status: { code: SpanStatusCode.OK },
    attributes: { existing: "value" },
    links: [],
    events: [],
    duration: [1, 0],
    ended: true,
    droppedAttributesCount: 0,
    droppedLinksCount: 0,
    droppedEventsCount: 0,
    instrumentationScope: { name: "temporal-workflow", version: "1.24.0" },
  } satisfies SerializableSpan;
  return { ...valid, ...overrides };
}

describe("createValidatedWorkflowSpanSink", () => {
  test("preserves trace identity and forwards workflow context", () => {
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    const resource = resourceFromAttributes({ "service.name": "test" });
    const sink = createValidatedWorkflowSpanSink(processor, resource);

    expect(sink.export.callDuringReplay).toBe(false);
    forwardValidatedWorkflowSpans(processor, resource, WORKFLOW_INFO, [span()]);

    const exported = exporter.getFinishedSpans();
    expect(exported).toHaveLength(1);
    expect(exported[0]?.spanContext()).toMatchObject({
      traceId: "0123456789abcdef0123456789abcdef",
      spanId: "0123456789abcdef",
    });
    expect(exported[0]?.parentSpanContext?.spanId).toBe("fedcba9876543210");
    expect(exported[0]?.parentSpanContext?.isRemote).toBe(true);
    expect(exported[0]?.parentSpanContext?.traceState?.serialize()).toBe(
      "vendor=parent",
    );
    expect(exported[0]?.instrumentationScope).toEqual({
      name: "temporal-workflow",
      version: "1.24.0",
    });
    expect(exported[0]?.attributes).toMatchObject({
      existing: "value",
      "temporal.namespace": "prod",
      "temporal.task_queue": "monorepo-workflows",
      "temporal.workflow_id": "workflow-1",
    });
  });

  test("rejects malformed trace identity", () => {
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    const resource = resourceFromAttributes({});

    expect(() => {
      forwardValidatedWorkflowSpans(processor, resource, WORKFLOW_INFO, [
        span({ spanContext: { traceId: "bad", spanId: "bad", traceFlags: 1 } }),
      ]);
    }).toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("rejects the obsolete SDK wire fields instead of losing parentage", () => {
    const exporter = new InMemorySpanExporter();
    const processor = new SimpleSpanProcessor(exporter);
    expect(() =>
      forwardValidatedWorkflowSpans(
        processor,
        resourceFromAttributes({}),
        WORKFLOW_INFO,
        [span({ parentSpanId: "fedcba9876543210" })],
      ),
    ).toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

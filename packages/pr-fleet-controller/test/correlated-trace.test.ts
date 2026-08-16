import { describe, expect, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import {
  correlatedTraceContext,
  withCorrelatedTrace,
} from "@shepherdjerred/pr-fleet-controller/src/controller-telemetry.ts";

const TRACE_ID = "1234567890abcdef1234567890abcdef";
const SPAN_ID = "abcdef1234567890";

describe("correlatedTraceContext", () => {
  test("carries the recorder's trace id as the parent span context", () => {
    // This is what the AI SDK integration reads when it starts a span, and it
    // is what the dashboard's `tracePrNumbers` lookup joins on: without it the
    // emitted spans get a fresh random trace id and a worker's model and tool
    // spans land in the fleet timeline instead of that PR's transcript.
    const spanContext = trace.getSpanContext(
      correlatedTraceContext({ traceId: TRACE_ID, spanId: SPAN_ID }),
    );

    expect(spanContext?.traceId).toBe(TRACE_ID);
    expect(spanContext?.spanId).toBe(SPAN_ID);
  });

  test("produces a sampled remote parent so child spans are recorded", () => {
    const spanContext = trace.getSpanContext(
      correlatedTraceContext({ traceId: TRACE_ID, spanId: SPAN_ID }),
    );

    // An unsampled or structurally invalid parent would make the SDK start a
    // fresh root trace, which is the exact failure this graft prevents.
    expect(spanContext?.traceFlags).toBe(1);
    expect(spanContext?.isRemote).toBe(true);
    expect(spanContext?.traceId).toHaveLength(32);
    expect(spanContext?.spanId).toHaveLength(16);
  });
});

describe("withCorrelatedTrace", () => {
  test("propagates the operation's resolved value and rejection", async () => {
    await expect(
      withCorrelatedTrace({ traceId: TRACE_ID, spanId: SPAN_ID }, () =>
        Promise.resolve("result"),
      ),
    ).resolves.toBe("result");
    await expect(
      withCorrelatedTrace({ traceId: TRACE_ID, spanId: SPAN_ID }, () =>
        Promise.reject(new Error("worker failed")),
      ),
    ).rejects.toThrow("worker failed");
  });
});

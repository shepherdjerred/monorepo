import { describe, expect, test } from "vitest";
import { canonicalOtlpJson, OtlpJsonPayloadSchema } from "#src/otlp.ts";

function span(extra: Record<string, unknown>) {
  return {
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    ...extra,
  };
}

describe("canonicalOtlpJson", () => {
  test("digests two key-orderings of the same payload identically", () => {
    // The payload schema is `.loose()`, so unrecognized keys survive parse in
    // whatever order the sender emitted them — plain JSON.stringify is not a
    // stable dedupe key.
    const first = OtlpJsonPayloadSchema.parse({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: {} }] },
          scopeSpans: [{ spans: [span({ alpha: 1, beta: 2 })] }],
        },
      ],
    });
    const second = OtlpJsonPayloadSchema.parse({
      resourceSpans: [
        {
          scopeSpans: [{ spans: [span({ beta: 2, alpha: 1 })] }],
          resource: { attributes: [{ value: {}, key: "service.name" }] },
        },
      ],
    });

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    expect(canonicalOtlpJson(first)).toBe(canonicalOtlpJson(second));
  });

  test("preserves array order, which is meaningful in OTLP", () => {
    const forward = OtlpJsonPayloadSchema.parse({
      resourceSpans: [
        { scopeSpans: [{ spans: [span({ seq: 1 }), span({ seq: 2 })] }] },
      ],
    });
    const reversed = OtlpJsonPayloadSchema.parse({
      resourceSpans: [
        { scopeSpans: [{ spans: [span({ seq: 2 }), span({ seq: 1 })] }] },
      ],
    });

    expect(canonicalOtlpJson(forward)).not.toBe(canonicalOtlpJson(reversed));
  });
});

import { describe, expect, test } from "vitest";
import {
  buildBoundedSynthesisInput,
  SYNTHESIS_INPUT_BYTE_LIMIT,
} from "./glitter-context-refresh-synthesis-limit.ts";

describe("Glitter synthesis input bound", () => {
  test("keeps the newest summaries inside the per-call byte ceiling", () => {
    const chunks = Array.from({ length: 20 }, (_, index) => ({
      key: `2025-${String(index + 1).padStart(2, "0")}`,
      summary: "x".repeat(50_000),
    }));

    const bounded = buildBoundedSynthesisInput({
      chunks,
      directRecentMessages: Array.from({ length: 30 }, (_, index) => index),
      hasRepairPrevious: false,
      buildMessages: ({ chunks: selected, directRecentMessages }) => ({
        prompt: JSON.stringify({ selected, directRecentMessages }),
      }),
      serializeMessages: JSON.stringify,
    });

    expect(bounded.inputBytes).toBeLessThanOrEqual(SYNTHESIS_INPUT_BYTE_LIMIT);
    expect(bounded.chunks.length).toBeLessThan(chunks.length);
    expect(bounded.chunks.at(-1)?.key).toBe(chunks.at(-1)?.key);
    expect(bounded.chunks[0]?.key).not.toBe(chunks[0]?.key);
    expect(bounded.directRecentMessages).toHaveLength(30);
  });

  test("reduces multibyte direct evidence after removing summaries", () => {
    const directRecentMessages = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      content: "界".repeat(500),
    }));
    const bounded = buildBoundedSynthesisInput({
      chunks: [{ summary: "x".repeat(SYNTHESIS_INPUT_BYTE_LIMIT) }],
      directRecentMessages,
      hasRepairPrevious: false,
      buildMessages: ({ chunks, directRecentMessages: direct }) => ({
        prompt: JSON.stringify({ chunks, direct }),
      }),
      serializeMessages: JSON.stringify,
    });

    expect(bounded.inputBytes).toBeLessThanOrEqual(SYNTHESIS_INPUT_BYTE_LIMIT);
    expect(bounded.chunks).toHaveLength(0);
    expect(bounded.directRecentMessages.length).toBeGreaterThanOrEqual(30);
    expect(bounded.directRecentMessages.length).toBeLessThan(500);
    expect(bounded.directRecentMessages.at(-1)?.id).toBe("499");
  });

  test("omits an oversized previous repair before rejecting fixed content", () => {
    const bounded = buildBoundedSynthesisInput({
      chunks: [],
      directRecentMessages: Array.from({ length: 30 }, (_, index) => index),
      hasRepairPrevious: true,
      buildMessages: ({ includeRepairPrevious }) => ({
        prompt: includeRepairPrevious
          ? "x".repeat(SYNTHESIS_INPUT_BYTE_LIMIT + 1)
          : "regenerate from the validation error",
      }),
      serializeMessages: (messages) => messages.prompt,
    });

    expect(bounded.includeRepairPrevious).toBe(false);
  });

  test("raises a non-retryable evidence error when fixed content is impossible", () => {
    expect(() =>
      buildBoundedSynthesisInput({
        chunks: [],
        directRecentMessages: Array.from({ length: 30 }, (_, index) => index),
        hasRepairPrevious: false,
        buildMessages: () => ({
          prompt: "x".repeat(SYNTHESIS_INPUT_BYTE_LIMIT + 1),
        }),
        serializeMessages: (messages) => messages.prompt,
      }),
    ).toThrow("reducing direct evidence to 30 messages");
  });
});

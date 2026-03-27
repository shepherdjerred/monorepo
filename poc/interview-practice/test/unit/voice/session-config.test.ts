import { describe, test, expect } from "bun:test";
import { buildRealtimeSessionConfig } from "#lib/voice/session-config.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { ToolDefinition } from "#lib/ai/client.ts";

function makePart(overrides?: Partial<QuestionPart>): QuestionPart {
  return {
    partNumber: 1,
    prompt:
      "Given an array of integers, find two numbers that add to a target.",
    internalNotes: "Hash map approach is optimal.",
    hints: [{ level: "subtle", content: "Think about lookups." }],
    testCases: [{ args: [[2, 7, 11], 9], expected: [0, 1] }],
    followUps: ["What if sorted?"],
    expectedApproach: "Hash map for O(n) lookup",
    expectedComplexity: { time: "O(n)", space: "O(n)" },
    ...overrides,
  };
}

function makeQuestion(overrides?: Partial<LeetcodeQuestion>): LeetcodeQuestion {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Two Sum",
    slug: "two-sum",
    difficulty: "easy",
    tags: ["array", "hash-table"],
    description: "Find two numbers...",
    parts: [makePart()],
    constraints: ["2 <= nums.length <= 10^4"],
    functionSignature: {
      name: "twoSum",
      params: [
        { name: "nums", type: "number[]" },
        { name: "target", type: "number" },
      ],
      returnType: "number[]",
    },
    source: "leetcode",
    escalationPattern: "constraint-addition",
    ...overrides,
  };
}

const mockTools: ToolDefinition[] = [
  {
    name: "run_tests",
    description: "Run tests",
    inputSchema: { properties: {}, required: [] },
  },
  {
    name: "give_hint",
    description: "Give a hint",
    inputSchema: {
      properties: { level: { type: "string" } },
      required: ["level"],
    },
  },
];

describe("buildRealtimeSessionConfig", () => {
  test("builds config with correct model and voice", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 2,
      timerDisplay: "20:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: mockTools,
    });

    expect(config.model).toBe("gpt-realtime-mini");
    expect(config.voice).toBe("ash");
  });

  test("includes input audio transcription", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 1,
      timerDisplay: "25:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: [],
    });

    expect(config.input_audio_transcription).toBeDefined();
    expect(config.input_audio_transcription?.model).toBe(
      "gpt-4o-mini-transcribe",
    );
  });

  test("includes server VAD turn detection", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 1,
      timerDisplay: "25:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: [],
    });

    expect(config.turn_detection).toBeDefined();
    expect(config.turn_detection?.type).toBe("server_vad");
    expect(config.turn_detection?.threshold).toBe(0.5);
    expect(config.turn_detection?.silence_duration_ms).toBe(500);
  });

  test("maps tools to realtime format", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 1,
      timerDisplay: "25:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: mockTools,
    });

    expect(config.tools).toHaveLength(2);
    expect(config.tools?.[0]?.type).toBe("function");
    expect(config.tools?.[0]?.name).toBe("run_tests");
    expect(config.tools?.[1]?.name).toBe("give_hint");
  });

  test("includes instructions with question context", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 2,
      timerDisplay: "20:00 remaining",
      hintsGiven: 1,
      testsRun: 3,
      tools: [],
    });

    expect(config.instructions).toContain("Two Sum");
    expect(config.instructions).toContain("easy");
    expect(config.instructions).toContain("Part 1 of 2");
    expect(config.instructions).toContain("20:00 remaining");
    expect(config.instructions).toContain("Hints given: 1");
    expect(config.instructions).toContain("Tests run: 3");
  });

  test("includes reflections in instructions when provided", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 1,
      timerDisplay: "25:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: [],
      reflections: "The candidate seems stuck on the hash map approach.",
    });

    expect(config.instructions).toContain("REFLECTIONS");
    expect(config.instructions).toContain("stuck on the hash map");
  });

  test("omits reflections section when not provided", () => {
    const config = buildRealtimeSessionConfig({
      model: "gpt-realtime-mini",
      voice: "ash",
      question: makeQuestion(),
      currentPart: makePart(),
      totalParts: 1,
      timerDisplay: "25:00 remaining",
      hintsGiven: 0,
      testsRun: 0,
      tools: [],
    });

    expect(config.instructions).not.toContain("REFLECTIONS");
  });
});

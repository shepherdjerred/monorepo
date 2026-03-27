import { describe, test, expect } from "bun:test";
import {
  estimateTokens,
  truncateToTokenBudget,
  truncateTranscript,
  formatReflectionsForContext,
  truncateCodeSnapshot,
  buildContext,
  DEFAULT_BUDGETS,
} from "#lib/ai/context-builder.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";
import type { Reflection } from "#lib/ai/reflection-queue.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";

function makeTranscriptEntry(
  overrides: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return {
    id: 1,
    role: "user",
    content: "test message",
    metadata: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    type: "observation",
    content: "test reflection",
    priority: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

const MOCK_QUESTION: LeetcodeQuestion = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Two Sum",
  slug: "two-sum",
  difficulty: "easy",
  tags: ["array", "hash-table"],
  description: "Given an array of integers...",
  parts: [
    {
      partNumber: 1,
      prompt: "Find two numbers that add up to target",
      internalNotes: "Classic hash map approach",
      hints: [],
      testCases: [],
      followUps: [],
      expectedApproach: "Hash map O(n)",
      expectedComplexity: { time: "O(n)", space: "O(n)" },
      transitionCriteria: {
        minApproachQuality: "working",
        mustExplainComplexity: true,
        transitionPrompt: "What if we need to find three numbers?",
      },
    },
  ],
  constraints: ["2 <= nums.length <= 10^4"],
  io: { inputFormat: "int[] nums, int target", outputFormat: "int[]" },
  source: "leetcode",
  escalationPattern: "constraint-addition",
};

describe("estimateTokens", () => {
  test("estimates 1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("truncateToTokenBudget", () => {
  test("returns text unchanged if within budget", () => {
    const text = "short";
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  test("truncates and adds marker when over budget", () => {
    const text = "a".repeat(100);
    const result = truncateToTokenBudget(text, 5); // 5 tokens = 20 chars
    expect(result.length).toBeLessThan(100);
    expect(result).toContain("[...truncated]");
  });
});

describe("truncateTranscript", () => {
  test("returns all entries if within budget", () => {
    const entries = [
      makeTranscriptEntry({ content: "hello" }),
      makeTranscriptEntry({ content: "world" }),
    ];
    const result = truncateTranscript(entries, 1000);
    expect(result).toHaveLength(2);
  });

  test("keeps most recent entries when truncating", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeTranscriptEntry({
        id: i + 1,
        content: "x".repeat(100),
      }),
    );
    const result = truncateTranscript(entries, 50); // 50 tokens = 200 chars
    expect(result.length).toBeLessThan(20);
    // Should include the last entry
    const lastEntry = result.at(-1);
    expect(lastEntry?.id).toBe(20);
  });

  test("handles empty transcript", () => {
    const result = truncateTranscript([], 100);
    expect(result).toHaveLength(0);
  });
});

describe("formatReflectionsForContext", () => {
  test("returns empty string for no reflections", () => {
    expect(formatReflectionsForContext([], 400)).toBe("");
  });

  test("formats reflections with type and priority", () => {
    const reflections = [
      makeReflection({
        type: "observation",
        priority: 7,
        content: "Candidate using brute force",
      }),
      makeReflection({
        type: "suggestion",
        priority: 5,
        content: "Consider giving a hint",
      }),
    ];
    const result = formatReflectionsForContext(reflections, 400);
    expect(result).toContain("REFLECTIONS FROM ANALYSIS:");
    expect(result).toContain("[observation] (p7)");
    expect(result).toContain("[suggestion] (p5)");
  });

  test("truncates to budget", () => {
    const reflections = Array.from({ length: 50 }, (_, i) =>
      makeReflection({ content: "x".repeat(100), priority: i }),
    );
    const result = formatReflectionsForContext(reflections, 10); // very small budget
    expect(result).toContain("[...truncated]");
  });
});

describe("truncateCodeSnapshot", () => {
  test("returns code unchanged if within budget", () => {
    const code = "const x = 1;\nconst y = 2;";
    expect(truncateCodeSnapshot(code, 100)).toBe(code);
  });

  test("keeps last lines and adds truncation marker", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${String(i)}`);
    const code = lines.join("\n");
    const result = truncateCodeSnapshot(code, 10); // small budget
    expect(result).toContain("[...earlier code truncated]");
    expect(result).toContain("line 49"); // last line should be present
  });
});

describe("buildContext", () => {
  test("produces a system prompt and transcript entries", () => {
    const result = buildContext({
      question: MOCK_QUESTION,
      currentPart: MOCK_QUESTION.parts[0]!,
      totalParts: 1,
      timerDisplay: "20:00 remaining",
      timerPhase: "first_half",
      hintsGiven: 0,
      testsRun: 0,
      recentTranscript: [
        makeTranscriptEntry({ role: "user", content: "I think we can use a hash map" }),
        makeTranscriptEntry({ role: "interviewer", content: "Tell me more about that approach" }),
      ],
      codeSnapshot: "function twoSum(nums, target) {}",
      reflections: [
        makeReflection({
          type: "observation",
          content: "Good approach identified",
          priority: 6,
        }),
      ],
      personaPrompt: "You are a FAANG interviewer.",
    });

    expect(result.systemPrompt).toContain("You are a FAANG interviewer");
    expect(result.systemPrompt).toContain("REFLECTIONS FROM ANALYSIS:");
    expect(result.systemPrompt).toContain("Good approach identified");
    expect(result.systemPrompt).toContain("CANDIDATE'S CURRENT CODE:");
    expect(result.transcriptEntries.length).toBeGreaterThan(0);
  });

  test("omits reflections section when no reflections", () => {
    const result = buildContext({
      question: MOCK_QUESTION,
      currentPart: MOCK_QUESTION.parts[0]!,
      totalParts: 1,
      timerDisplay: "20:00 remaining",
      timerPhase: "first_half",
      hintsGiven: 0,
      testsRun: 0,
      recentTranscript: [],
      codeSnapshot: null,
      reflections: [],
      personaPrompt: "You are a FAANG interviewer.",
    });

    expect(result.systemPrompt).not.toContain("REFLECTIONS FROM ANALYSIS:");
  });

  test("omits code section when no snapshot", () => {
    const result = buildContext({
      question: MOCK_QUESTION,
      currentPart: MOCK_QUESTION.parts[0]!,
      totalParts: 1,
      timerDisplay: "20:00 remaining",
      timerPhase: "first_half",
      hintsGiven: 0,
      testsRun: 0,
      recentTranscript: [],
      codeSnapshot: null,
      reflections: [],
      personaPrompt: "You are a FAANG interviewer.",
    });

    expect(result.systemPrompt).not.toContain("CANDIDATE'S CURRENT CODE:");
  });

  test("respects custom token budgets", () => {
    const longPersona = "x".repeat(10_000);
    const result = buildContext({
      question: MOCK_QUESTION,
      currentPart: MOCK_QUESTION.parts[0]!,
      totalParts: 1,
      timerDisplay: "20:00 remaining",
      timerPhase: "first_half",
      hintsGiven: 0,
      testsRun: 0,
      recentTranscript: [],
      codeSnapshot: null,
      reflections: [],
      personaPrompt: longPersona,
      budgets: { ...DEFAULT_BUDGETS, persona: 10 }, // very small persona budget
    });

    // The persona section should be truncated
    expect(result.systemPrompt).toContain("[...truncated]");
    expect(result.systemPrompt.length).toBeLessThan(longPersona.length);
  });
});

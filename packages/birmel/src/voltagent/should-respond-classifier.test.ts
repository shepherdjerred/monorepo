import { describe, expect, it, mock } from "bun:test";
import * as aiActual from "ai";

type ClassifierObject = { shouldRespond: boolean; reason?: string };

// Mutable implementation so each test can swap behavior without re-importing
// the module under test (which captures `generateText` at load time).
let generateTextImpl: (args: {
  prompt: string;
}) => Promise<{ output: ClassifierObject }>;
let lastPrompt = "";

// Spread the real `ai` exports so the rest of the package (which imports
// `stepCountIs`, etc. from `ai`) keeps working — this mock is process-global.
// `generateText` is mocked, so the real `openai()` model arg is never used
// and no network call happens.
await mock.module("ai", () => ({
  ...aiActual,
  generateText: (args: { prompt: string }) => {
    lastPrompt = args.prompt;
    return generateTextImpl(args);
  },
}));

const { classifyShouldRespond } =
  await import("./should-respond-classifier.ts");

const baseInput = {
  persona: "virmel",
  transcript: "Alice: hey birmel",
  latestMessage: "Alice: you there?",
  guildId: "g",
  channelId: "c",
  userId: "u",
};

describe("classifyShouldRespond", () => {
  it("returns the model's decision and feeds it persona + transcript", async () => {
    generateTextImpl = async () => ({
      output: { shouldRespond: true, reason: "directed at me" },
    });
    const result = await classifyShouldRespond(baseInput);
    expect(result).toBe(true);
    expect(lastPrompt).toContain("virmel");
    expect(lastPrompt).toContain("Alice: hey birmel");
    expect(lastPrompt).toContain("Alice: you there?");
  });

  it("returns false when the model declines", async () => {
    generateTextImpl = async () => ({
      output: { shouldRespond: false },
    });
    expect(await classifyShouldRespond(baseInput)).toBe(false);
  });

  it("fails closed when the model call throws", async () => {
    generateTextImpl = async () => {
      throw new Error("api down");
    };
    expect(await classifyShouldRespond(baseInput)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { getThresholdValue, hasAIKeywords, scoreSentiment } from "./sentiment.ts";

describe("scoreSentiment", () => {
  describe("should match negative AI comments (real HN quotes)", () => {
    test("stochastic parrot", () => {
      const result = scoreSentiment("Don't believe the PR bull. It is just a stochastic parrot.");
      expect(result.score).toBeGreaterThanOrEqual(0.4);
      expect(result.matches.some((m) => m.category === "reductive-label")).toBe(true);
    });

    test("spicy autocomplete + dismissive just", () => {
      const result = scoreSentiment("LLMs are just spicy autocomplete. They can't reason.");
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });

    test("spicy autocomplete + LLMs can't reason", () => {
      const result = scoreSentiment("LLMs are just spicy autocomplete. LLMs can't reason.");
      expect(result.score).toBeGreaterThanOrEqual(0.6);
      expect(result.matches.length).toBeGreaterThanOrEqual(3);
    });

    test("AI slop", () => {
      const result = scoreSentiment("AI slop garbage");
      expect(result.score).toBeGreaterThanOrEqual(0.4);
      expect(result.matches.some((m) => m.category === "slop")).toBe(true);
    });

    test("glorified autocomplete", () => {
      const result = scoreSentiment("glorified autocomplete that wastes energy");
      expect(result.score).toBeGreaterThanOrEqual(0.4);
    });

    test("crypto bubble comparison", () => {
      const result = scoreSentiment(
        "It's the crypto bubble all over again but for AI",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.25);
      expect(result.matches.some((m) => m.category === "bubble")).toBe(true);
    });

    test("stochastic parrot + confidently wrong", () => {
      const result = scoreSentiment("confidently wrong stochastic parrots");
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });

    test("vibe coding contempt", () => {
      const result = scoreSentiment("vibe coding unmaintainable trash");
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    test("AI bro ad hominem", () => {
      const result = scoreSentiment("AI bros make excuse after excuse");
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    test("cargo cult", () => {
      const result = scoreSentiment("cargo cult programming, automated");
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    test("snake oil framing", () => {
      const result = scoreSentiment("the AI snake-oil salesmen are at it again");
      expect(result.score).toBeGreaterThanOrEqual(0.4);
    });

    test("emperor's new clothes", () => {
      const result = scoreSentiment(
        "We're so far beyond emperor's new clothes territory with AI",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    test("blurry jpeg of the web", () => {
      const result = scoreSentiment("LLMs are a blurry jpeg of the web");
      expect(result.score).toBeGreaterThanOrEqual(0.4);
    });

    test("AI hype standalone", () => {
      const result = scoreSentiment(
        "This is not good for the AI hype and nor any continued support for future investment",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.25);
      expect(result.matches.some((m) => m.category === "bubble")).toBe(true);
    });

    test("AI replacement doom", () => {
      const result = scoreSentiment(
        "And like everyone else you trained the AI how to replace you",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.15);
      expect(result.matches.some((m) => m.category === "replacement-doom")).toBe(true);
    });

    test("AI boosters ad hominem", () => {
      const result = scoreSentiment(
        "AI boosters mostly use AI to do useless stuff focused on pretending to improve productivity",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.25);
      expect(result.matches.some((m) => m.category === "ad-hominem")).toBe(true);
    });

    test("vibe codebase pejorative", () => {
      const result = scoreSentiment(
        "I imagine your accountant had the same reaction I do when an amateur shows me their vibe codebase",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.15);
    });

    test("AI making obsolete", () => {
      const result = scoreSentiment(
        "I'm starting to believe using AI is more likely to make you obsolete than not",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    test("multiple tier 2 patterns together", () => {
      const result = scoreSentiment(
        "AI bubble will burst, it's just confidently wrong hallucinations that are useless",
      );
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("should NOT match legitimate technical discussion", () => {
    test("technical description of mechanism", () => {
      const result = scoreSentiment(
        "The model uses next-token prediction during inference",
      );
      expect(result.score).toBeLessThan(0.4);
    });

    test("constructive hallucination discussion", () => {
      const result = scoreSentiment(
        "We should discuss hallucination mitigation strategies",
      );
      expect(result.score).toBeLessThan(0.4);
    });

    test("balanced opinion", () => {
      const result = scoreSentiment(
        "I tried Claude for code review and found mixed results",
      );
      expect(result.score).toBeLessThan(0.4);
    });

    test("nuanced take", () => {
      const result = scoreSentiment("LLMs are useful for X but limited at Y");
      expect(result.score).toBeLessThan(0.4);
    });

    test("about actual autocomplete (not AI)", () => {
      const result = scoreSentiment("The autocomplete in my IDE is getting better");
      expect(result.score).toBeLessThan(0.4);
    });

    test("neutral mention of AI capabilities", () => {
      const result = scoreSentiment(
        "I've been using AI coding tools for my side project and they help with boilerplate",
      );
      expect(result.score).toBeLessThan(0.4);
    });

    test("skill atrophy without AI keyword (LLM-only)", () => {
      const result = scoreSentiment(
        "I believe your skills are atrophying when you use these things",
      );
      expect(result.score).toBe(0);
    });

    test("discussing AI limitations constructively", () => {
      const result = scoreSentiment(
        "The main limitation I've found is context window size, which affects long refactors",
      );
      expect(result.score).toBe(0);
    });
  });
});

describe("hasAIKeywords", () => {
  test("detects AI keywords", () => {
    expect(hasAIKeywords("LLMs are interesting")).toBe(true);
    expect(hasAIKeywords("ChatGPT is useful")).toBe(true);
    expect(hasAIKeywords("I used Claude today")).toBe(true);
    expect(hasAIKeywords("vibe coding is fun")).toBe(true);
    expect(hasAIKeywords("artificial intelligence")).toBe(true);
  });

  test("does not match non-AI text", () => {
    expect(hasAIKeywords("I went to the store")).toBe(false);
    expect(hasAIKeywords("This is about databases")).toBe(false);
    expect(hasAIKeywords("React hooks are confusing")).toBe(false);
  });
});

describe("getThresholdValue", () => {
  test("returns correct values", () => {
    expect(getThresholdValue("low")).toBe(0.4);
    expect(getThresholdValue("medium")).toBe(0.6);
    expect(getThresholdValue("high")).toBe(0.8);
  });
});

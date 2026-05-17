import { describe, expect, test } from "bun:test";
import { classifyOpenAIProviderIssue } from "./provider-metrics.ts";

describe("classifyOpenAIProviderIssue", () => {
  test("classifies insufficient quota 429s as quota issues", () => {
    const issue = classifyOpenAIProviderIssue(
      new Error(
        "429 You exceeded your current quota, please check your plan and billing details",
      ),
    );

    expect(issue).toBe("quota");
  });

  test("classifies generic 429s as rate-limit issues", () => {
    const issue = classifyOpenAIProviderIssue(
      new Error("429 Rate limit reached for gpt-5.1"),
    );

    expect(issue).toBe("rate_limit");
  });

  test("ignores unrelated errors", () => {
    const issue = classifyOpenAIProviderIssue(new Error("connection reset"));

    expect(issue).toBeNull();
  });
});

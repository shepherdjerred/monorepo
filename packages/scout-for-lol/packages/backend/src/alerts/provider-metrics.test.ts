import { describe, expect, test } from "bun:test";
import { classifyLlmProviderIssue } from "./provider-metrics.ts";

describe("classifyLlmProviderIssue", () => {
  test("classifies insufficient quota 429s as quota issues", () => {
    const issue = classifyLlmProviderIssue(
      new Error(
        "429 You exceeded your current quota, please check your plan and billing details",
      ),
    );

    expect(issue).toBe("quota");
  });

  test("classifies OpenRouter credit failures as quota issues", () => {
    expect(
      classifyLlmProviderIssue({
        statusCode: 402,
        message: "Insufficient credits. Add more credits and retry.",
      }),
    ).toBe("quota");
  });

  test("classifies generic 429s as rate-limit issues", () => {
    const issue = classifyLlmProviderIssue(
      new Error("429 Rate limit reached for gpt-5.1"),
    );

    expect(issue).toBe("rate_limit");
  });

  test("classifies LLM budget circuit-breaker errors as budget issues", () => {
    const error = new Error(
      "LLM hourly token budget exceeded: 2000000 / 2000000",
    );
    error.name = "LlmBudgetExceeded";

    const issue = classifyLlmProviderIssue(error);

    expect(issue).toBe("budget_exceeded");
  });

  test("classifies input token limit errors as context issues", () => {
    const issue = classifyLlmProviderIssue({
      status: 400,
      error: {
        message:
          "Input tokens exceed the configured limit of 272000 tokens. Your messages resulted in 305127 tokens.",
        type: "invalid_request_error",
      },
    });

    expect(issue).toBe("context_limit");
  });

  test("classifies context length errors as context issues", () => {
    const issue = classifyLlmProviderIssue({
      status: 400,
      message: "This model's context length is 128000 tokens.",
      type: "invalid_request_error",
    });

    expect(issue).toBe("context_limit");
  });

  test("does not classify unrelated token-limit validation errors as context issues", () => {
    const issue = classifyLlmProviderIssue({
      status: 400,
      message: "max_completion_tokens exceeds the output token limit.",
      type: "invalid_request_error",
    });

    expect(issue).toBeNull();
  });

  test("ignores unrelated errors", () => {
    const issue = classifyLlmProviderIssue(new Error("connection reset"));

    expect(issue).toBeNull();
  });
});

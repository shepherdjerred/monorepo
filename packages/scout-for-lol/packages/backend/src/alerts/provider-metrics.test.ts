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

  test("classifies OpenAI budget circuit-breaker errors as budget issues", () => {
    const error = new Error(
      "OpenAI hourly token budget exceeded: 2000000 / 2000000",
    );
    error.name = "OpenAIBudgetExceeded";

    const issue = classifyOpenAIProviderIssue(error);

    expect(issue).toBe("budget_exceeded");
  });

  test("classifies OpenAI input token limit errors as context issues", () => {
    const issue = classifyOpenAIProviderIssue({
      status: 400,
      error: {
        message:
          "Input tokens exceed the configured limit of 272000 tokens. Your messages resulted in 305127 tokens.",
        type: "invalid_request_error",
      },
    });

    expect(issue).toBe("context_limit");
  });

  test("classifies OpenAI context length errors as context issues", () => {
    const issue = classifyOpenAIProviderIssue({
      status: 400,
      message: "This model's context length is 128000 tokens.",
      type: "invalid_request_error",
    });

    expect(issue).toBe("context_limit");
  });

  test("does not classify unrelated token-limit validation errors as context issues", () => {
    const issue = classifyOpenAIProviderIssue({
      status: 400,
      message: "max_completion_tokens exceeds the output token limit.",
      type: "invalid_request_error",
    });

    expect(issue).toBeNull();
  });

  test("ignores unrelated errors", () => {
    const issue = classifyOpenAIProviderIssue(new Error("connection reset"));

    expect(issue).toBeNull();
  });
});

import { describe, expect, test } from "vitest";
import {
  classifyLlmProviderIssue,
  providerForError,
} from "./provider-metrics.ts";

describe("classifyLlmProviderIssue", () => {
  test("classifies insufficient quota 429s as quota issues", () => {
    const issue = classifyLlmProviderIssue(
      new Error(
        "429 You exceeded your current quota, please check your plan and billing details",
      ),
    );

    expect(issue).toBe("quota");
  });

  test("classifies credit failures as quota issues", () => {
    expect(
      classifyLlmProviderIssue({
        statusCode: 402,
        message: "Insufficient credits. Add more credits and retry.",
      }),
    ).toBe("quota");
  });

  test("classifies provider hard spend caps as quota issues", () => {
    expect(
      classifyLlmProviderIssue({
        status: 429,
        message:
          "You exceeded your current quota, please check your plan and billing details.",
        error: { type: "insufficient_quota" },
      }),
    ).toBe("quota");
    expect(
      classifyLlmProviderIssue({
        status: 400,
        message:
          "You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.",
      }),
    ).toBe("quota");
  });

  test("no longer treats a router weekly key limit as a quota", () => {
    // OpenRouter's per-key weekly limit was the old cap. A 403 now means an
    // authorization problem, which retrying or waiting does not fix either,
    // but it is not a spend cap and must not be reported as one.
    expect(
      classifyLlmProviderIssue({
        status: 403,
        message: "Key limit exceeded: weekly limit reached for this key",
      }),
    ).toBeNull();
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

describe("providerForError", () => {
  test("names the provider from the failed request's URL", () => {
    expect(
      providerForError({ url: "https://api.anthropic.com/v1/messages" }),
    ).toBe("anthropic");
    expect(
      providerForError({
        url: "https://aiplatform.googleapis.com/v1/projects/p/locations/global",
      }),
    ).toBe("google");
  });

  test("looks through retry wrappers and causes", () => {
    // The AI SDK's RetryError carries the real APICallError as lastError.
    expect(
      providerForError({
        name: "AI_RetryError",
        lastError: { url: "https://api.openai.com/v1/responses" },
      }),
    ).toBe("openai");
    expect(
      providerForError(
        new Error("wrapped", {
          cause: { url: "https://api.openai.com/v1/responses" },
        }),
      ),
    ).toBe("openai");
  });

  test("admits it does not know rather than guessing from configuration", () => {
    expect(providerForError(new Error("no url here"))).toBe("unknown");
    expect(providerForError({ url: "not a url" })).toBe("unknown");
  });
});

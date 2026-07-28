import { describe, expect, test } from "bun:test";
import { ApplicationFailure } from "@temporalio/activity";
import {
  agentSubprocessFailure,
  isNonRetryableAgentFailure,
  truncateLastLine,
} from "./agent-task-failures.ts";
import type { TrackedAgentResult } from "#shared/agent-subprocess.ts";

function result(partial: Partial<TrackedAgentResult> = {}): TrackedAgentResult {
  return {
    exitCode: 1,
    signal: "natural",
    durationMs: 1000,
    maxIdleMs: 100,
    firstOutputLatencyMs: 50,
    softKillFired: false,
    sigkillEscalated: false,
    stdout: "",
    lastLine: "",
    ...partial,
  };
}

describe("isNonRetryableAgentFailure", () => {
  test("detects OpenAI 401 missing bearer", () => {
    expect(
      isNonRetryableAgentFailure(
        '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer"}}',
      ),
    ).toBe(true);
  });

  test("detects Claude weekly limit 429", () => {
    expect(
      isNonRetryableAgentFailure(
        '{"api_error_status":429,"result":"You\'ve hit your weekly limit"}',
      ),
    ).toBe(true);
  });

  test("keeps generic provider 429 responses retryable", () => {
    expect(
      isNonRetryableAgentFailure(
        '{"api_error_status":429,"result":"request throttled"}',
      ),
    ).toBe(false);
  });

  test("keeps temporary rate limits retryable", () => {
    expect(isNonRetryableAgentFailure("rate limit exceeded")).toBe(false);
  });

  test("does not treat max_turns as non-retryable", () => {
    expect(
      isNonRetryableAgentFailure(
        '{"type":"result","subtype":"error_max_turns"}',
      ),
    ).toBe(false);
  });
});

describe("agentSubprocessFailure", () => {
  test("includes truncated lastLine in the message", () => {
    const error = agentSubprocessFailure(
      "codex",
      result({ lastLine: "boom " + "x".repeat(400) }),
    );
    expect(error.message).toContain("codex agent task exited with code 1");
    expect(error.message.length).toBeLessThan(400);
  });

  test("returns ApplicationFailure for auth errors", () => {
    const error = agentSubprocessFailure(
      "codex",
      result({
        lastLine:
          "unexpected status 401 Unauthorized: Missing bearer or basic authentication",
      }),
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    if (!(error instanceof ApplicationFailure)) {
      throw new TypeError("expected ApplicationFailure");
    }
    expect(error.nonRetryable).toBe(true);
  });
});

describe("truncateLastLine", () => {
  test("collapses whitespace", () => {
    expect(truncateLastLine("a\n\tb  c")).toBe("a b c");
  });
});

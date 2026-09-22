import type { Usage } from "@openai/codex-sdk";
import { describe, expect, test, vi } from "vitest";
import { appServerNotification, type AppServerEventState } from "./events.ts";

function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

describe("Codex App Server notifications", () => {
  test("accumulates only this turn's model-call usage", () => {
    const state: AppServerEventState = {
      threadId: "thread-1",
      usage: emptyUsage(),
      toolSteps: 0,
      completed: false,
    };
    type Breakdown = {
      totalTokens: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningOutputTokens: number;
    };
    const notify = (total: Breakdown, last: Breakdown): void => {
      appServerNotification({
        message: {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            tokenUsage: {
              total,
              last,
            },
          },
        },
        state,
        maxTurns: 4,
        turnBudgetKind: "tool-steps",
        onExecutionState: vi.fn(),
      });
    };

    notify(
      {
        totalTokens: 114,
        inputTokens: 90,
        cachedInputTokens: 22,
        outputTokens: 24,
        reasoningOutputTokens: 11,
      },
      {
        totalTokens: 14,
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
        reasoningOutputTokens: 1,
      },
    );
    notify(
      {
        totalTokens: 134,
        inputTokens: 105,
        cachedInputTokens: 27,
        outputTokens: 29,
        reasoningOutputTokens: 13,
      },
      {
        totalTokens: 20,
        inputTokens: 15,
        cachedInputTokens: 5,
        outputTokens: 5,
        reasoningOutputTokens: 2,
      },
    );

    expect(state.usage).toEqual({
      input_tokens: 25,
      cached_input_tokens: 7,
      cache_write_input_tokens: 0,
      output_tokens: 9,
      reasoning_output_tokens: 3,
    });
  });
});

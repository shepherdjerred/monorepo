import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BENCHMARK_GOAL,
  buildBenchmarkSummary,
  parseBenchmarkArgs,
  summarizeCodexJsonl,
} from "./benchmark-harness.ts";

describe("parseBenchmarkArgs", () => {
  test("requires artifacts and preserves the exact default goal", () => {
    const parsed = parseBenchmarkArgs(
      [
        "--save",
        "fixture.sav",
        "--wasm=game.wasm",
        "--output",
        "artifacts",
        "--runs",
        "2",
        "--control-port",
        "19000",
      ],
      "/repo/packages/discord-plays-pokemon",
      "/work",
    );

    expect(parsed.goal).toBe(DEFAULT_BENCHMARK_GOAL);
    expect(parsed.goal).toBe("get me a pokeman");
    expect(parsed.save).toBe("/work/fixture.sav");
    expect(parsed.wasm).toBe("/work/game.wasm");
    expect(parsed.output).toBe("/work/artifacts");
    expect(parsed.implementationRoot).toBe(
      "/repo/packages/discord-plays-pokemon",
    );
    expect(parsed.runs).toBe(2);
    expect(parsed.controlPort).toBe(19_000);
  });

  test("rejects unknown flags and overflowing per-run ports", () => {
    const required = [
      "--save",
      "fixture.sav",
      "--wasm",
      "game.wasm",
      "--output",
      "artifacts",
    ];
    expect(() =>
      parseBenchmarkArgs(
        [...required, "--mystery", "value"],
        "/package",
        "/work",
      ),
    ).toThrow("unknown argument");
    expect(() =>
      parseBenchmarkArgs(
        [
          ...required,
          "--runs",
          "2",
          "--control-port",
          "49151",
          "--port-stride",
          "1",
        ],
        "/package",
        "/work",
      ),
    ).toThrow("exceeds 49151");
  });
});

describe("summarizeCodexJsonl", () => {
  test("counts turns, commands, failures, domain queries, and token usage", () => {
    const lines = [
      { type: "thread.started", thread_id: "thread-123" },
      { type: "turn.started" },
      {
        type: "item.started",
        item: {
          id: "move-1",
          type: "command_execution",
          command: "pokemonctl press up",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "move-1",
          type: "command_execution",
          command: "pokemonctl press up",
          aggregated_output: '{"blocked":true}',
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          id: "shot-1",
          type: "command_execution",
          command: ["pokemonctl", "screenshot"],
          exit_code: 1,
          stderr: "failed",
        },
      },
      {
        type: "item.started",
        item: {
          id: "knowledge-1",
          type: "command_execution",
          command: 'pokemonctl grep "route" knowledge',
        },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 80,
          output_tokens: 20,
          reasoning_output_tokens: 10,
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");

    expect(summarizeCodexJsonl(`${lines}\nnot-json\n`)).toEqual({
      turns: 1,
      toolCalls: 3,
      toolErrors: 1,
      errors: 2,
      movementActions: 1,
      movementStops: 1,
      repeatedPositionLoops: 0,
      ignoredInputs: 0,
      screenshots: 1,
      knowledgeQueries: 1,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      codexThreadId: "thread-123",
    });
  });
});

describe("buildBenchmarkSummary", () => {
  test("requires every requested run to succeed", () => {
    const summary = buildBenchmarkSummary(2, [
      {
        run: 1,
        success: true,
        durationMs: 1000,
        telemetry: {
          turns: 2,
          toolCalls: 3,
          errors: 0,
          inputTokens: 100,
          outputTokens: 20,
          reasoningOutputTokens: 10,
          estimatedCostUsd: 0.1,
        },
      },
      {
        run: 2,
        success: false,
        durationMs: 2000,
        telemetry: {
          turns: 4,
          toolCalls: 5,
          errors: 1,
          inputTokens: 200,
          outputTokens: 40,
          reasoningOutputTokens: 20,
          estimatedCostUsd: null,
        },
      },
    ]);

    expect(summary.allSucceeded).toBe(false);
    expect(summary.successfulRuns).toBe(1);
    expect(summary.failedRuns).toBe(1);
    expect(summary.totals).toEqual({
      durationMs: 3000,
      turns: 6,
      toolCalls: 8,
      errors: 1,
      inputTokens: 300,
      outputTokens: 60,
      reasoningOutputTokens: 30,
      knownCostUsd: 0.1,
      runsWithUnknownCost: 1,
    });
  });
});

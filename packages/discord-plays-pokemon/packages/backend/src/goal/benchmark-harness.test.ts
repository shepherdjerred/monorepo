import { describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  DEFAULT_BENCHMARK_GOAL,
  buildBenchmarkSummary,
  parseBenchmarkArgs,
  summarizeCodexJsonl,
  type BenchmarkRunOutcome,
  type BenchmarkRunSummaryEntry,
} from "./benchmark-harness.ts";
import {
  classifyCodexProviderFailure,
  type BenchmarkProviderFailure,
} from "./benchmark-provider-failure.ts";
import {
  commandOutput,
  requireCleanGitWorktree,
  reserveBenchmarkDirectory,
} from "./benchmark-run.ts";
import { runBenchmarkSeries } from "./benchmark-series.ts";

async function git(command: readonly string[], cwd: string): Promise<string> {
  return await commandOutput(["git", ...command], cwd);
}

function productionObservation(x: number) {
  return {
    schemaVersion: 1,
    id: `observation-${String(x)}`,
    world: {
      map: "Route 101",
      mapGroup: 0,
      mapNum: 16,
      x,
      y: 8,
    },
  };
}

function benchmarkEntry(
  run: number,
  outcome: BenchmarkRunOutcome,
  providerFailure: BenchmarkProviderFailure | null = null,
): BenchmarkRunSummaryEntry {
  return {
    run,
    success: outcome === "success",
    outcome,
    providerFailure,
    durationMs: 1000,
    telemetry: {
      turns: 1,
      toolCalls: 2,
      errors: 0,
      inputTokens: 100,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      estimatedCostUsd: 0.1,
    },
  };
}

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
          id: "observe-shot-1",
          type: "command_execution",
          command: "pokemonctl observe --screenshot",
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
      toolCalls: 4,
      toolErrors: 1,
      errors: 2,
      movementActions: 1,
      movementStops: 1,
      repeatedPositionLoops: 0,
      ignoredInputs: 0,
      screenshots: 2,
      knowledgeQueries: 1,
      inputTokens: 100,
      cachedInputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      codexThreadId: "thread-123",
    });
  });

  test("derives movement loops and stops from structured action outcomes", () => {
    const commands = [
      {
        id: "move-out",
        command: "pokemonctl move east --tiles 1",
        output: {
          status: "completed",
          before: { map: "Route 101", x: 10, y: 8 },
          after: { map: "Route 101", x: 11, y: 8 },
        },
      },
      {
        id: "move-return",
        command: "pokemonctl move west --tiles 1",
        output: {
          outcome: {
            status: "completed",
            before: { mapId: "Route 101", x: 11, y: 8 },
            after: { mapId: "Route 101", x: 10, y: 8 },
          },
        },
      },
      {
        id: "move-stopped",
        command: "pokemonctl tap north",
        output: {
          status: "stopped",
          stopReason: "collision",
          before: { mapGroup: 0, mapNum: 16, x: 10, y: 8 },
          after: { mapGroup: 0, mapNum: 16, x: 10, y: 8 },
        },
      },
    ].map(({ id, command, output }) => ({
      type: "item.completed",
      item: {
        id,
        type: "command_execution",
        command,
        aggregated_output: JSON.stringify(output),
        exit_code: 0,
      },
    }));

    const telemetry = summarizeCodexJsonl(
      commands.map((line) => JSON.stringify(line)).join("\n"),
    );
    expect(telemetry.movementActions).toBe(3);
    expect(telemetry.movementStops).toBe(1);
    expect(telemetry.repeatedPositionLoops).toBe(2);
  });

  test("reads production observation worlds and treats completed as normal", () => {
    const line = {
      type: "item.completed",
      item: {
        id: "production-move",
        type: "command_execution",
        command: "pokemonctl move east --tiles 1",
        aggregated_output: JSON.stringify({
          schemaVersion: 1,
          action: "move:east",
          status: "applied",
          stopReason: "completed",
          before: productionObservation(10),
          after: productionObservation(11),
        }),
        exit_code: 0,
      },
    };

    const telemetry = summarizeCodexJsonl(JSON.stringify(line));
    expect(telemetry.movementActions).toBe(1);
    expect(telemetry.movementStops).toBe(0);
    expect(telemetry.repeatedPositionLoops).toBe(0);
  });

  test("supports legacy Location snapshots and ignores command text without position output", () => {
    const lines = [
      {
        type: "item.completed",
        item: {
          id: "legacy-1",
          type: "command_execution",
          command: "pokemonctl press up",
          aggregated_output:
            "Location: Littleroot Town @ (12, 7) facing north, on foot",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          id: "legacy-2",
          type: "command_execution",
          command: "pokemonctl press up",
          aggregated_output:
            "Location: Littleroot Town @ (12, 7) facing north, on foot",
          exit_code: 0,
        },
      },
      {
        type: "item.completed",
        item: {
          id: "no-evidence",
          type: "command_execution",
          command: "pokemonctl move north --tiles 10",
          aggregated_output: "command finished",
          exit_code: 0,
        },
      },
    ];
    const telemetry = summarizeCodexJsonl(
      lines.map((line) => JSON.stringify(line)).join("\n"),
    );

    expect(telemetry.toolCalls).toBe(3);
    expect(telemetry.movementActions).toBe(2);
    expect(telemetry.repeatedPositionLoops).toBe(1);
  });
});

describe("classifyCodexProviderFailure", () => {
  test("classifies the observed quota turn failure as invalid provider evidence", () => {
    const jsonl = [
      { type: "thread.started", thread_id: "thread-123" },
      { type: "turn.started" },
      {
        type: "error",
        message: "Quota exceeded. Check your plan and billing details.",
      },
      {
        type: "turn.failed",
        error: {
          message: "Quota exceeded. Check your plan and billing details.",
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");

    expect(classifyCodexProviderFailure({ jsonl, codexExitCode: 1 })).toEqual({
      schemaVersion: 1,
      kind: "quota",
      phase: "turn",
      source: "codex-jsonl",
      message: "Quota exceeded. Check your plan and billing details.",
      eventType: "error",
      codexExitCode: 1,
    });
  });

  test("distinguishes authentication and structured turn failures", () => {
    expect(
      classifyCodexProviderFailure({
        jsonl: "",
        codexExitCode: null,
        startupError: "Codex authentication required; run codex login",
      }),
    ).toMatchObject({
      kind: "authentication",
      phase: "startup",
      source: "startup-exception",
    });
    expect(
      classifyCodexProviderFailure({
        jsonl: JSON.stringify({ type: "thread.started", thread_id: "thread" }),
        codexExitCode: 78,
      }),
    ).toBeNull();
    expect(
      classifyCodexProviderFailure({
        jsonl: [
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({
            type: "turn.failed",
            error: { message: "upstream unavailable" },
          }),
        ].join("\n"),
        codexExitCode: 1,
      }),
    ).toMatchObject({
      kind: "provider-turn",
      phase: "turn",
      source: "codex-jsonl",
      message: "upstream unavailable",
    });
    expect(
      classifyCodexProviderFailure({
        jsonl: [
          JSON.stringify({ type: "turn.started" }),
          JSON.stringify({ type: "turn.completed", usage: {} }),
        ].join("\n"),
        codexExitCode: 0,
      }),
    ).toBeNull();
  });
});

describe("benchmark artifact reservation", () => {
  test("rejects empty and nonempty pre-existing directories", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "pokemon-benchmark-output-"),
    );
    const empty = path.join(root, "empty");
    const nonempty = path.join(root, "nonempty");
    await mkdir(empty);
    await Bun.write(path.join(nonempty, "stale-screenshot.png"), "stale", {
      createPath: true,
    });

    try {
      await expect(
        reserveBenchmarkDirectory(empty, "benchmark output"),
      ).rejects.toThrow(
        "refusing to reuse existing benchmark output directory",
      );
      await expect(
        reserveBenchmarkDirectory(nonempty, "benchmark run"),
      ).rejects.toThrow("refusing to reuse existing benchmark run directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reserves a new directory exactly once", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "pokemon-benchmark-output-"),
    );
    const output = path.join(root, "new");
    try {
      await reserveBenchmarkDirectory(output, "benchmark output");
      const outputStat = await stat(output);
      expect(outputStat.isDirectory()).toBe(true);
      await expect(
        reserveBenchmarkDirectory(output, "benchmark output"),
      ).rejects.toThrow(
        "refusing to reuse existing benchmark output directory",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("benchmark worker does not import runner-only benchmark helpers", async () => {
  const worker = await Bun.file(
    path.resolve(import.meta.dir, "../../scripts/goal-benchmark-worker.ts"),
  ).text();
  expect(worker).not.toContain("#src/goal/benchmark-");
  expect(worker).toContain("EXTERNAL_PROVIDER_STARTUP_PATTERN.test(message)");
  expect(worker).toContain(".some((entry) => entry.id === goalId)");
  expect(worker).toContain(
    'helper_dir: path.join(config.runDirectory, ".pokemon-goal-bin")',
  );
});

describe("runBenchmarkSeries", () => {
  test("stops immediately after an invalid provider measurement", async () => {
    const quotaFailure = classifyCodexProviderFailure({
      jsonl: [
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "turn.failed",
          error: { message: "Quota exceeded" },
        }),
      ].join("\n"),
      codexExitCode: 1,
    });
    if (quotaFailure === null) {
      throw new Error("quota fixture must classify as a provider failure");
    }
    const executed: number[] = [];
    const entries = await runBenchmarkSeries(3, (run) => {
      executed.push(run);
      return Promise.resolve(
        benchmarkEntry(run, "invalid-provider", quotaFailure),
      );
    });

    expect(executed).toEqual([1]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.outcome).toBe("invalid-provider");
  });

  test("continues after a valid game failure", async () => {
    const executed: number[] = [];
    const entries = await runBenchmarkSeries(3, (run) => {
      executed.push(run);
      return Promise.resolve(
        benchmarkEntry(run, run === 1 ? "game-failure" : "success"),
      );
    });

    expect(executed).toEqual([1, 2, 3]);
    expect(entries.map((entry) => entry.outcome)).toEqual([
      "game-failure",
      "success",
      "success",
    ]);
  });
});

describe("buildBenchmarkSummary", () => {
  test("requires every requested run to succeed", () => {
    const summary = buildBenchmarkSummary(2, [
      {
        run: 1,
        success: true,
        outcome: "success",
        providerFailure: null,
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
        outcome: "game-failure",
        providerFailure: null,
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
    expect(summary.validRuns).toBe(2);
    expect(summary.successfulRuns).toBe(1);
    expect(summary.failedRuns).toBe(1);
    expect(summary.invalidRuns).toBe(0);
    expect(summary.providerFailureRuns).toBe(0);
    expect(summary.harnessErrorRuns).toBe(0);
    expect(summary.stoppedEarly).toBe(false);
    expect(summary.stopReason).toBeNull();
    expect(summary.successRate).toBe(0.5);
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

  test("reports an early provider stop as invalid rather than game failure", () => {
    const quotaFailure = classifyCodexProviderFailure({
      jsonl: JSON.stringify({
        type: "turn.failed",
        error: { message: "Quota exceeded" },
      }),
      codexExitCode: 1,
    });
    if (quotaFailure === null) {
      throw new Error("quota fixture must classify as a provider failure");
    }
    const summary = buildBenchmarkSummary(3, [
      benchmarkEntry(1, "invalid-provider", quotaFailure),
    ]);

    expect(summary.completedRuns).toBe(1);
    expect(summary.validRuns).toBe(0);
    expect(summary.successfulRuns).toBe(0);
    expect(summary.failedRuns).toBe(0);
    expect(summary.invalidRuns).toBe(1);
    expect(summary.providerFailureRuns).toBe(1);
    expect(summary.harnessErrorRuns).toBe(0);
    expect(summary.stoppedEarly).toBe(true);
    expect(summary.stopReason).toBe("external-provider-failure");
    expect(summary.successRate).toBeNull();
    expect(summary.allSucceeded).toBe(false);
  });
});

describe("requireCleanGitWorktree", () => {
  test("accepts a clean target and rejects tracked target drift", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "pokemon-benchmark-git-"),
    );
    try {
      await git(["init"], directory);
      await git(
        ["config", "user.email", "benchmark@example.invalid"],
        directory,
      );
      await git(["config", "user.name", "Benchmark Test"], directory);
      await Bun.write(path.join(directory, "target.txt"), "committed\n");
      await git(["add", "target.txt"], directory);
      await git(
        ["-c", "commit.gpgsign=false", "commit", "-m", "test: fixture"],
        directory,
      );

      await expect(
        requireCleanGitWorktree(directory, "target implementation"),
      ).resolves.toBeUndefined();
      await Bun.write(path.join(directory, "target.txt"), "dirty\n");
      await expect(
        requireCleanGitWorktree(directory, "target implementation"),
      ).rejects.toThrow("target implementation must be clean");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

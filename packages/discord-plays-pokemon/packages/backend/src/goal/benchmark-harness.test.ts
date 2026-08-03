import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { summarizeCodexJsonl } from "./benchmark-codex-telemetry.ts";
import {
  DEFAULT_BENCHMARK_GOAL,
  buildBenchmarkSummary,
  parseBenchmarkArgs,
  type BenchmarkRunOutcome,
  type BenchmarkRunSummaryEntry,
} from "./benchmark-harness.ts";
import {
  captureCatchBenchmarkSourceSave,
  validateCatchBenchmarkSourceSave,
} from "./benchmark-source-save.ts";
import {
  classifyCodexProviderFailure,
  type BenchmarkProviderFailure,
} from "./benchmark-provider-failure.ts";
import {
  commandOutput,
  requireCleanGitWorktree,
  reserveBenchmarkDirectory,
} from "./benchmark-run.ts";
import { requireBenchmarkPathOutsideGitWorktrees } from "./benchmark-output-location.ts";
import {
  OPTIONAL_CODEX_INSTRUCTION_PATHS,
  prepareBenchmarkRuntimeOverlay,
  REQUIRED_CODEX_INSTRUCTION_PATHS,
} from "./benchmark-runtime-overlay.ts";
import { runBenchmarkSeries } from "./benchmark-series.ts";
import { harnessErrorLifecycle } from "./benchmark-result.ts";
import { prepareRuntimeTools } from "./goal-runtime-env.ts";

const SAVE_SLOT_BYTES = 0xe0_00;
const SAVE_SECTOR_BYTES = 0x10_00;
const SAVE_SLOT_SECTORS = 14;
const SAVE_SECTOR_CHECKSUM_OFFSET = 0xf_f6;
const SAVE_SECTOR_ID_OFFSET = 0xf_f4;
const SAVE_SECTOR_COUNTER_OFFSET = 0xf_fc;
const MAX_SAVE_COUNTER = 0xff_ff_ff_ff;
const WASM32_CHUNK_SIZES: readonly number[] = [
  0xf_08, 0xf_80, 0xf_80, 0xf_80, 0xd_c0, 0xf_80, 0xf_80, 0xf_80, 0xf_80,
  0xf_80, 0xf_80, 0xf_80, 0xf_80, 0x7_d0,
];

function sectorChecksum(
  view: DataView,
  sectorOffset: number,
  chunkSize: number,
): number {
  let sum = 0;
  for (let offset = 0; offset < chunkSize; offset += 4) {
    sum = (sum + view.getUint32(sectorOffset + offset, true)) >>> 0;
  }
  return ((sum >>> 16) + (sum & 0xff_ff)) & 0xff_ff;
}

function setSlotCounter(
  view: DataView,
  slotOffset: number,
  counter: number,
): void {
  for (let sector = 0; sector < SAVE_SLOT_SECTORS; sector += 1) {
    view.setUint32(
      slotOffset + sector * SAVE_SECTOR_BYTES + SAVE_SECTOR_COUNTER_OFFSET,
      counter,
      true,
    );
  }
}

function convertToWasm32Checksums(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const slotOffset of [0, SAVE_SLOT_BYTES]) {
    for (let sector = 0; sector < SAVE_SLOT_SECTORS; sector += 1) {
      const sectorOffset = slotOffset + sector * SAVE_SECTOR_BYTES;
      const id = view.getUint16(sectorOffset + SAVE_SECTOR_ID_OFFSET, true);
      const chunkSize = WASM32_CHUNK_SIZES[id];
      if (chunkSize === undefined) {
        throw new Error(
          `test fixture has invalid logical sector ${String(id)}`,
        );
      }
      view.setUint16(
        sectorOffset + SAVE_SECTOR_CHECKSUM_OFFSET,
        sectorChecksum(view, sectorOffset, chunkSize),
        true,
      );
    }
  }
}

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

function actionObservation(phase: "overworld" | "battle" | "other", x: number) {
  return {
    schemaVersion: 2,
    phase,
    context: {
      kind: phase === "overworld" ? "field" : phase,
    },
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
      compactObservations: 1,
      fullObservations: 2,
      toolOutputCharacters: 1000,
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
    expect(parsed.codexBinary).toBe("codex");
    expect(parsed.implementationRoot).toBe(
      "/repo/packages/discord-plays-pokemon",
    );
    expect(parsed.runs).toBe(2);
    expect(parsed.controlPort).toBe(19_000);
  });

  test("resolves path-like Codex binaries without changing PATH commands", () => {
    const required = [
      "--save",
      "fixture.sav",
      "--wasm",
      "game.wasm",
      "--output",
      "artifacts",
    ];

    const pathLike = parseBenchmarkArgs(
      [...required, "--codex-binary", "./bin/codex"],
      "/package",
      "/work",
    );
    const pathCommand = parseBenchmarkArgs(
      [...required, "--codex-binary", "codex"],
      "/package",
      "/work",
    );

    expect(pathLike.codexBinary).toBe("/work/bin/codex");
    expect(pathCommand.codexBinary).toBe("codex");
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

describe("validateCatchBenchmarkSourceSave", () => {
  test("captures immutable bytes and provenance before the source path changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pokemon-source-save-"));
    const savePath = path.join(root, "source.sav");
    const original = await Bun.file(
      new URL("../game/events/testdata/after_starter.sav", import.meta.url),
    ).bytes();
    const replacement = await Bun.file(
      new URL("../game/events/testdata/champion.sav", import.meta.url),
    ).bytes();
    const originalHasher = new Bun.CryptoHasher("sha256");
    originalHasher.update(original);
    const replacementHasher = new Bun.CryptoHasher("sha256");
    replacementHasher.update(replacement);

    try {
      await Bun.write(savePath, original);
      const captured = await captureCatchBenchmarkSourceSave(savePath);
      await Bun.write(savePath, replacement);

      expect(captured.bytes).toEqual(original);
      expect(captured.sha256).toBe(originalHasher.digest("hex"));
      expect(captured.sha256).not.toBe(replacementHasher.digest("hex"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a real source save with room for caught Pokemon", async () => {
    const save = await Bun.file(
      new URL("../game/events/testdata/after_starter.sav", import.meta.url),
    ).bytes();

    expect(() => validateCatchBenchmarkSourceSave(save)).not.toThrow();
  });

  test("accepts a save checksummed with the pinned wasm32 block layout", async () => {
    const save = Uint8Array.from(
      await Bun.file(
        new URL("../game/events/testdata/after_starter.sav", import.meta.url),
      ).bytes(),
    );
    convertToWasm32Checksums(save);

    expect(() => validateCatchBenchmarkSourceSave(save)).not.toThrow();
  });

  test("rejects per-sector mixing of the two supported block layouts", async () => {
    const save = Uint8Array.from(
      await Bun.file(
        new URL("../game/events/testdata/after_starter.sav", import.meta.url),
      ).bytes(),
    );
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    for (const slotOffset of [0, SAVE_SLOT_BYTES]) {
      for (let sector = 0; sector < SAVE_SLOT_SECTORS; sector += 1) {
        const sectorOffset = slotOffset + sector * SAVE_SECTOR_BYTES;
        const id = view.getUint16(sectorOffset + SAVE_SECTOR_ID_OFFSET, true);
        if (id === 0) {
          view.setUint32(sectorOffset + 0xf_10, 1, true);
          view.setUint16(
            sectorOffset + SAVE_SECTOR_CHECKSUM_OFFSET,
            sectorChecksum(view, sectorOffset, 0xf_2c),
            true,
          );
        } else if (id === 4) {
          view.setUint16(
            sectorOffset + SAVE_SECTOR_CHECKSUM_OFFSET,
            sectorChecksum(view, sectorOffset, 0xd_c0),
            true,
          );
        }
      }
    }

    expect(() => validateCatchBenchmarkSourceSave(save)).toThrow(
      "source save has no valid slot containing SaveBlock1 party data",
    );
  });

  test("rejects a real full-party save before a benchmark can run", async () => {
    const save = await Bun.file(
      new URL("../game/events/testdata/champion.sav", import.meta.url),
    ).bytes();

    expect(() => validateCatchBenchmarkSourceSave(save)).toThrow(
      "source save has a full party; catch benchmark requires an empty party slot so every successful catch produces independent party-identity evidence",
    );
  });

  test("rejects malformed flash images without guessing at party capacity", () => {
    expect(() =>
      validateCatchBenchmarkSourceSave(new Uint8Array(128 * 1024)),
    ).toThrow("source save has no valid slot containing SaveBlock1 party data");
    expect(() =>
      validateCatchBenchmarkSourceSave(new Uint8Array(128 * 1024 - 1)),
    ).toThrow("source save must be exactly 131072 bytes; got 131071");
  });

  test("rejects incomplete slots even when their remaining sectors look valid", async () => {
    const save = Uint8Array.from(
      await Bun.file(
        new URL("../game/events/testdata/after_starter.sav", import.meta.url),
      ).bytes(),
    );
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    view.setUint32(0xf_f8, 0, true);
    view.setUint32(0xe0_00 + 0xf_f8, 0, true);

    expect(() => validateCatchBenchmarkSourceSave(save)).toThrow(
      "source save has no valid slot containing SaveBlock1 party data",
    );
  });

  test("rejects slots whose logical data does not match the stored checksum", async () => {
    const save = Uint8Array.from(
      await Bun.file(
        new URL("../game/events/testdata/after_starter.sav", import.meta.url),
      ).bytes(),
    );
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    view.setUint16(
      SAVE_SECTOR_CHECKSUM_OFFSET,
      view.getUint16(SAVE_SECTOR_CHECKSUM_OFFSET, true) ^ 1,
      true,
    );
    view.setUint16(
      SAVE_SLOT_BYTES + SAVE_SECTOR_CHECKSUM_OFFSET,
      view.getUint16(SAVE_SLOT_BYTES + SAVE_SECTOR_CHECKSUM_OFFSET, true) ^ 1,
      true,
    );

    expect(() => validateCatchBenchmarkSourceSave(save)).toThrow(
      "source save has no valid slot containing SaveBlock1 party data",
    );
  });

  test("selects counter zero over max counter at the exact rollover", async () => {
    const roomy = await Bun.file(
      new URL("../game/events/testdata/after_starter.sav", import.meta.url),
    ).bytes();
    const full = await Bun.file(
      new URL("../game/events/testdata/champion.sav", import.meta.url),
    ).bytes();
    const save = new Uint8Array(128 * 1024);
    save.set(full.subarray(0, SAVE_SLOT_BYTES), 0);
    save.set(
      roomy.subarray(SAVE_SLOT_BYTES, SAVE_SLOT_BYTES * 2),
      SAVE_SLOT_BYTES,
    );
    const view = new DataView(save.buffer, save.byteOffset, save.byteLength);
    setSlotCounter(view, 0, MAX_SAVE_COUNTER);
    setSlotCounter(view, SAVE_SLOT_BYTES, 0);

    expect(() => validateCatchBenchmarkSourceSave(save)).not.toThrow();

    setSlotCounter(view, 0, 0);
    setSlotCounter(view, SAVE_SLOT_BYTES, MAX_SAVE_COUNTER);
    expect(() => validateCatchBenchmarkSourceSave(save)).toThrow(
      "source save has a full party",
    );
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
      compactObservations: 1,
      fullObservations: 0,
      toolOutputCharacters: 22,
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
        command: "pokemonctl tap down",
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
});

describe("summarizeCodexJsonl movement filtering", () => {
  test("counts only directional field controls as movement", () => {
    const commands = [
      {
        id: "battle-confirm",
        command: ["pokemonctl", "tap", "a"],
        output: {
          action: "tap:a",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("battle", 10),
          after: actionObservation("battle", 10),
        },
      },
      {
        id: "open-menu",
        command: "pokemonctl press start",
        output: {
          action: "tap:start",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("overworld", 10),
          after: actionObservation("other", 10),
        },
      },
      {
        id: "interact",
        command: "pokemonctl interact east",
        output: {
          action: "interact",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("overworld", 10),
          after: actionObservation("overworld", 10),
        },
      },
      {
        id: "battle-cursor",
        command: "pokemonctl tap down",
        output: {
          action: "tap:down",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("battle", 10),
          after: actionObservation("battle", 10),
        },
      },
      {
        id: "battle-raw-direction",
        command: "pokemonctl press up --hold-ms 100",
        output: {
          action: "press:raw",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("battle", 10),
          after: actionObservation("battle", 10),
        },
      },
      {
        id: "blocked-semantic-move",
        command: ["bun", "run", "pokemonctl-entrypoint.sh"],
        output: {
          action: "move:east",
          status: "stopped",
          stopReason: "collision",
          before: actionObservation("overworld", 10),
          after: actionObservation("overworld", 10),
        },
      },
      {
        id: "wrapped-navigation",
        command: [
          "/bin/zsh",
          "-lc",
          "/runtime/.pokemon-goal-bin/pokemonctl navigate --x 11 --y 8",
          { ignored: true },
        ],
        output: {
          outcome: {
            action: "navigate",
            status: "arrived",
            stopReason: "target-reached",
            before: actionObservation("overworld", 10),
            after: actionObservation("overworld", 11),
          },
        },
      },
      {
        id: "field-directional-tap",
        command: "'/runtime/.pokemon-goal-bin/pokemonctl' tap l",
        output: {
          action: "tap:l",
          status: "applied",
          stopReason: "completed",
          before: actionObservation("overworld", 11),
          after: actionObservation("overworld", 11),
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
    expect(telemetry.toolCalls).toBe(8);
    expect(telemetry.movementActions).toBe(3);
    expect(telemetry.movementStops).toBe(1);
    expect(telemetry.repeatedPositionLoops).toBe(2);
  });
});

describe("summarizeCodexJsonl observation formats", () => {
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
      {
        type: "item.completed",
        item: {
          id: "legacy-menu",
          type: "command_execution",
          command: "pokemonctl press start",
          aggregated_output:
            "Location: Littleroot Town @ (12, 7) facing north, on foot",
          exit_code: 0,
        },
      },
    ];
    const telemetry = summarizeCodexJsonl(
      lines.map((line) => JSON.stringify(line)).join("\n"),
    );

    expect(telemetry.toolCalls).toBe(4);
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
        jsonl: "",
        codexExitCode: null,
        startupError: "EACCES writing runtime helper",
      }),
    ).toBeNull();
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

describe("benchmark output containment", () => {
  test("rejects output and runtime paths inside either Git worktree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pokemon-output-location-"));
    const targetRoot = path.join(root, "target");
    const runnerRoot = path.join(root, "runner");
    const targetAlias = path.join(root, "target-alias");
    await Promise.all([mkdir(targetRoot), mkdir(runnerRoot)]);
    await symlink(targetRoot, targetAlias, "dir");
    const worktrees = [
      { root: targetRoot, label: "target implementation" },
      { root: runnerRoot, label: "benchmark runner" },
    ];

    try {
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          worktrees,
          path.join(targetRoot, "benchmark-artifacts"),
          "benchmark output",
        ),
      ).rejects.toThrow(
        "benchmark output must be outside the target implementation Git worktree",
      );
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          worktrees,
          path.join(runnerRoot, "benchmark-artifacts"),
          "benchmark output",
        ),
      ).rejects.toThrow(
        "benchmark output must be outside the benchmark runner Git worktree",
      );
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          worktrees,
          path.join(targetAlias, "benchmark-artifacts"),
          "benchmark output",
        ),
      ).rejects.toThrow(
        "benchmark output must be outside the target implementation Git worktree",
      );
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          worktrees,
          path.join(targetRoot, "artifacts/run-001/runtime"),
          "benchmark runtime overlay",
        ),
      ).rejects.toThrow(
        "benchmark runtime overlay must be outside the target implementation Git worktree",
      );
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          worktrees,
          path.join(runnerRoot, "artifacts/run-001/runtime"),
          "benchmark runtime overlay",
        ),
      ).rejects.toThrow(
        "benchmark runtime overlay must be outside the benchmark runner Git worktree",
      );
      expect(await readdir(targetRoot)).toEqual([]);
      expect(await readdir(runnerRoot)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a sibling path with a shared name prefix", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pokemon-output-sibling-"));
    const implementationRoot = path.join(root, "implementation");
    await mkdir(implementationRoot);
    try {
      await expect(
        requireBenchmarkPathOutsideGitWorktrees(
          [{ root: implementationRoot, label: "target implementation" }],
          path.join(root, "implementation-copy", "benchmark-artifacts"),
          "benchmark output",
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("CLI preflights containment before reserving the output directory", async () => {
    const source = await Bun.file(
      path.resolve(import.meta.dir, "../../scripts/goal-benchmark.ts"),
    ).text();
    const containmentCheck = source.indexOf(
      "await requireBenchmarkPathOutsideGitWorktrees(",
    );
    const artifactReservation = source.indexOf(
      'await reserveBenchmarkDirectory(args.output, "benchmark output")',
    );

    expect(containmentCheck).toBeGreaterThan(-1);
    expect(artifactReservation).toBeGreaterThan(containmentCheck);
    expect(source).toContain(
      "benchmarkGitWorktrees(implementation.gitRoot, runnerGitRoot)",
    );
  });
});

describe("benchmark runtime overlay", () => {
  test("matches the production image's Codex instruction surface", async () => {
    const dockerfile = await Bun.file(
      path.resolve(import.meta.dir, "../../../../Dockerfile"),
    ).text();
    const scopedCopyStart = dockerfile.indexOf("# Scoped source closure.");
    const scopedCopyEnd = dockerfile.indexOf(
      "# Keep the deployed Codex instruction surface",
      scopedCopyStart,
    );
    const runtimePresenceEnd = dockerfile.indexOf(
      "# Built artifacts from the build stage.",
      scopedCopyEnd,
    );

    expect(scopedCopyStart).toBeGreaterThan(-1);
    expect(scopedCopyEnd).toBeGreaterThan(scopedCopyStart);
    expect(runtimePresenceEnd).toBeGreaterThan(scopedCopyEnd);

    const scopedCopy = dockerfile.slice(scopedCopyStart, scopedCopyEnd);
    const runtimePresenceChecks = dockerfile.slice(
      scopedCopyEnd,
      runtimePresenceEnd,
    );
    const instructionPaths = [
      ...REQUIRED_CODEX_INSTRUCTION_PATHS,
      ...OPTIONAL_CODEX_INSTRUCTION_PATHS,
    ];

    for (const relativePath of instructionPaths) {
      const dockerPath = `packages/discord-plays-pokemon/${relativePath}`;
      expect(scopedCopy).toContain(`  ${dockerPath} \\`);
      expect(runtimePresenceChecks).toContain(dockerPath);
    }
  });

  test("copies only the target runtime surface and isolates helper writes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pokemon-runtime-overlay-"));
    const implementationRoot = path.join(root, "implementation");
    const runDirectory = path.join(root, "artifacts", "run-001");
    await mkdir(runDirectory, { recursive: true });
    await Bun.write(
      path.join(implementationRoot, "AGENTS.md"),
      "target instructions\n",
      { createPath: true },
    );
    await Bun.write(
      path.join(implementationRoot, "packages/backend/package.json"),
      '{"imports":{"#src/*":"./src/*"}}\n',
      { createPath: true },
    );
    await Bun.write(
      path.join(implementationRoot, ".agents/skills/pokemon-world/SKILL.md"),
      "world skill\n",
      { createPath: true },
    );
    await Bun.write(
      path.join(implementationRoot, "packages/backend/src/goal/pokemonctl.ts"),
      "process.stdout.write('old pokemonctl\\n');\n",
      { createPath: true },
    );
    await Bun.write(
      path.join(
        implementationRoot,
        "packages/backend/src/game/battle/generated/item-names.ts",
      ),
      "export const itemNames = [];\n",
      { createPath: true },
    );
    await Bun.write(
      path.join(
        implementationRoot,
        "packages/backend/node_modules/zod/index.js",
      ),
      "export const z = {};\n",
      { createPath: true },
    );

    try {
      const runtimeDirectory = await prepareBenchmarkRuntimeOverlay(
        implementationRoot,
        runDirectory,
      );
      expect(runtimeDirectory).toBe(path.join(runDirectory, "runtime"));
      expect(
        await Bun.file(path.join(runtimeDirectory, "AGENTS.md")).text(),
      ).toBe("target instructions\n");
      expect(
        await Bun.file(
          path.join(runtimeDirectory, ".agents/skills/pokemon-world/SKILL.md"),
        ).text(),
      ).toBe("world skill\n");
      expect(
        await Bun.file(
          path.join(
            runtimeDirectory,
            "packages/backend/src/goal/pokemonctl.ts",
          ),
        ).text(),
      ).toBe("process.stdout.write('old pokemonctl\\n');\n");
      // The overlay no longer injects any runner-owned worker helper: the
      // streamed worker inlines its boot-readiness glue, so a pre-helper target
      // is copied verbatim and never gains benchmark-worker-boot-readiness.ts.
      expect(
        await Bun.file(
          path.join(
            runtimeDirectory,
            "packages/backend/src/goal/benchmark-worker-boot-readiness.ts",
          ),
        ).exists(),
      ).toBe(false);
      expect(
        await Bun.file(path.join(runtimeDirectory, "package.json")).exists(),
      ).toBe(false);
      expect(
        await Bun.file(
          path.join(runtimeDirectory, "packages/backend/package.json"),
        ).text(),
      ).toBe('{"imports":{"#src/*":"./src/*"}}\n');

      await prepareRuntimeTools(
        path.join(runtimeDirectory, ".pokemon-goal-bin"),
      );
      expect(
        await Bun.file(
          path.join(runtimeDirectory, ".pokemon-goal-bin/pokemonctl"),
        ).exists(),
      ).toBe(true);
      expect(
        await Bun.file(
          path.join(implementationRoot, ".pokemon-goal-bin/pokemonctl"),
        ).exists(),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("executes the copied current pokemonctl dependency graph", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pokemon-runtime-exec-"));
    const implementationRoot = path.resolve(import.meta.dir, "../../../..");
    const runDirectory = path.join(root, "run-001");
    await mkdir(runDirectory);
    try {
      const runtimeDirectory = await prepareBenchmarkRuntimeOverlay(
        implementationRoot,
        runDirectory,
      );
      const child = Bun.spawn(
        [
          "bun",
          path.join(
            runtimeDirectory,
            "packages/backend/src/goal/pokemonctl.ts",
          ),
          "--help",
        ],
        {
          cwd: runtimeDirectory,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("pokemonctl observe");
      expect(stdout).toContain("pokemonctl navigate");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects an overlay nested in the target implementation", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "pokemon-runtime-contained-"),
    );
    try {
      await expect(
        prepareBenchmarkRuntimeOverlay(
          root,
          path.join(root, "benchmark-output", "run-001"),
        ),
      ).rejects.toThrow(
        "benchmark runtime overlay must be outside the target implementation",
      );
      expect(await Bun.file(path.join(root, "benchmark-output")).exists()).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("harness-error lifecycle preserves the actual Codex exit code", () => {
  expect(
    harnessErrorLifecycle({
      startedAt: "2026-07-29T13:00:00.000Z",
      finishedAt: "2026-07-29T13:01:00.000Z",
      durationMs: 60_000,
      codexExitCode: 70,
      workerExitCode: 0,
    }),
  ).toEqual({
    startedAt: "2026-07-29T13:00:00.000Z",
    finishedAt: "2026-07-29T13:01:00.000Z",
    durationMs: 60_000,
    goalStatus: null,
    codexExitCode: 70,
    workerExitCode: 0,
  });
});

test("benchmark worker inlines its boot-readiness glue instead of importing it", async () => {
  const worker = await Bun.file(
    path.resolve(import.meta.dir, "../../scripts/goal-benchmark-worker.ts"),
  ).text();
  const benchmarkImports = [
    ...worker.matchAll(/from "(#src\/goal\/benchmark-[^"]+)"/gu),
  ].map((match) => match[1]);
  // The streamed worker must not import any benchmark-harness module from the
  // target: those resolve against arbitrary comparison checkouts, which is what
  // module-not-founded pre-helper targets before this fix.
  expect(benchmarkImports).toEqual([]);
  // It inlines the boot glue and still imports the stable gameplay readers those
  // functions call (present in every comparison target).
  expect(worker).toContain("async function bootBenchmarkSave(");
  expect(worker).toContain("function assessBenchmarkBootReadiness(");
  expect(worker).toContain('from "#src/goal/game-observation.ts"');
  expect(worker).toContain('started.kind === "missing_credential"');
  expect(worker).toContain(".some((entry) => entry.id === goalId)");
  expect(worker).not.toContain("helper_dir:");
  expect(worker).toContain("runtime_directory: config.runtimeDirectory");
});

test("streamed worker boots against a target predating the boot-readiness helper", async () => {
  const backendRoot = path.resolve(import.meta.dir, "../..");
  const workerSource = await Bun.file(
    path.join(backendRoot, "scripts/goal-benchmark-worker.ts"),
  ).text();
  // Stand in for a comparison checkout made before the harness helper existed:
  // a verbatim copy of the current backend source with
  // benchmark-worker-boot-readiness.ts removed. Keep the ephemeral copy outside
  // the package tree so concurrent lint never observes a directory disappearing
  // mid-traversal. A node_modules symlink preserves normal dependency resolution
  // while "#src/*" resolves to this helper-free copy.
  const target = await mkdtemp(path.join(tmpdir(), "pre-helper-target-"));
  try {
    await cp(path.join(backendRoot, "src"), path.join(target, "src"), {
      recursive: true,
    });
    await symlink(
      path.join(backendRoot, "node_modules"),
      path.join(target, "node_modules"),
      "dir",
    );
    await rm(path.join(target, "src/goal/benchmark-worker-boot-readiness.ts"), {
      force: true,
    });
    await Bun.write(
      path.join(target, "package.json"),
      `${JSON.stringify({
        name: "pre-helper-target",
        imports: { "#src/*": "./src/*" },
      })}\n`,
    );
    expect(
      await Bun.file(
        path.join(target, "src/goal/benchmark-worker-boot-readiness.ts"),
      ).exists(),
    ).toBe(false);

    const child = Bun.spawn(["bun", "run", "-"], {
      cwd: target,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await child.stdin.write(workerSource);
    await child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const output = stdout + stderr;

    // Resolving the whole worker graph against a helper-free checkout and
    // reaching main()'s argument check (the worker logs the uncaught error to
    // stdout) proves the boot-readiness glue is runner-owned (inlined), never
    // resolved from the target. A retained import would instead surface a
    // "Cannot find module ...benchmark-worker-boot-readiness" resolution error.
    expect(output).not.toContain("benchmark-worker-boot-readiness");
    expect(output).not.toContain("Cannot find");
    expect(exitCode).not.toBe(0);
    expect(output).toContain("benchmark worker requires --config");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}, 30_000);

test("benchmark runner rejects an unidentifiable dirty implementation", async () => {
  const runner = await Bun.file(
    path.resolve(import.meta.dir, "../../scripts/goal-benchmark.ts"),
  ).text();

  expect(runner).toContain('"target implementation"');
  expect(runner).toContain('"benchmark runner"');
  expect(runner).not.toContain("runnerStatus.length");
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
          compactObservations: 1,
          fullObservations: 2,
          toolOutputCharacters: 1000,
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
          compactObservations: 3,
          fullObservations: 4,
          toolOutputCharacters: 2000,
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
      compactObservations: 4,
      fullObservations: 6,
      toolOutputCharacters: 3000,
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
      const nestedDirectory = path.join(directory, "packages", "nested");
      await mkdir(nestedDirectory, { recursive: true });
      expect(
        await commandOutput(
          ["git", "rev-parse", "--show-toplevel"],
          nestedDirectory,
        ),
      ).toBe(await realpath(directory));
      await Bun.write(path.join(directory, "target.txt"), "dirty\n");
      await expect(
        requireCleanGitWorktree(directory, "target implementation"),
      ).rejects.toThrow("target implementation must be clean");
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

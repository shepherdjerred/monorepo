// End-to-end harness for the /goal pipeline (T8). Wires up GoalManager against
// a stub spawner that emits canned JSONL covering the T1-T7 surface (turn
// start/complete with usage, agent_message, ExecCommandBegin/End). Asserts the
// full integration: codex args, prompt content, cost line in the Discord
// message, persisted history, and OTel span synthesis.
//
// This is NOT a real-OpenAI-API run — that needs a real ROM, a working
// emulator boot, and a paid API call. The matching real-API smoke test is
// documented in the plan's acceptance section as a manual pre-merge gate.
//
// Run as a test:
//     bun test src/goal/e2e-goal.integration.test.ts
// Or via the script alias from the package root:
//     bun run e2e:goal
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import type { Config } from "#src/config/schema.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import {
  GoalManager,
  type GoalDiscordMessage,
  type GoalProcessSpawner,
} from "./goal-manager.ts";

// Canned JSONL the stub codex emits. 2 turns, each with a tool call + agent
// message + usage block.
const STUB_JSONL_EVENTS = [
  `{"type":"turn.started"}`,
  `{"type":"ExecCommandBegin","call_id":"call-1","command":["pokemonctl","screenshot"]}`,
  String.raw`{"type":"ExecCommandEnd","call_id":"call-1","exit_code":0,"stdout":"{\"path\":\"/tmp/x.png\"}","stderr":""}`,
  `{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Took a screenshot, see a dialog box."}}`,
  `{"type":"turn.completed","usage":{"input_tokens":15234,"cached_input_tokens":13000,"output_tokens":42,"reasoning_output_tokens":18}}`,
  `{"type":"turn.started"}`,
  `{"type":"ExecCommandBegin","call_id":"call-2","command":["pokemonctl","chord","3a"]}`,
  String.raw`{"type":"ExecCommandEnd","call_id":"call-2","exit_code":0,"stdout":"{\"ok\":true}","stderr":""}`,
  `{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Advanced dialog 3x."}}`,
  `{"type":"turn.completed","usage":{"input_tokens":15800,"cached_input_tokens":14500,"output_tokens":30,"reasoning_output_tokens":12}}`,
].join("\n");

const FINAL_REPORT =
  "Advanced past dialog. Player in overworld. Goal complete.";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const originalOpenAiKey = Bun.env.OPENAI_API_KEY;

beforeEach(() => {
  trace.setGlobalTracerProvider(provider);
  exporter.reset();
  Bun.env.OPENAI_API_KEY = "stub-key-e2e-only";
});

afterEach(() => {
  trace.disable();
  if (originalOpenAiKey === undefined) {
    delete Bun.env.OPENAI_API_KEY;
  } else {
    Bun.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

async function createRuntimeDirectory(): Promise<string> {
  const directory = path.join(
    Bun.env.TMPDIR ?? "/tmp",
    `e2e-goal-${crypto.randomUUID()}`,
  );
  await Bun.write(path.join(directory, ".keep"), "", { createPath: true });
  return directory;
}

function emerald1BadgeSnapshot(): GameSnapshot {
  return {
    party: [
      {
        personality: 1,
        otId: 1,
        species: 277, // Treecko
        level: 12,
        hp: 29,
        maxHp: 31,
        isEgg: false,
        nickname: "TREECKO",
      },
    ],
    badges: Array.from({ length: 8 }, (_, i) => i === 0),
    dexOwned: new Uint8Array(52),
    caughtMonSpecies: 0,
    caughtMonShiny: false,
  };
}

type SpawnerRecord = {
  spawner: GoalProcessSpawner;
  spawnedArgs: () => string[];
};

function makeStubSpawner(): SpawnerRecord {
  let capturedArgs: string[] = [];
  const spawner: GoalProcessSpawner = (args) => {
    capturedArgs = args;
    const outputIdx = args.indexOf("--output-last-message");
    if (outputIdx === -1) throw new Error("missing --output-last-message");
    const outputPath = args[outputIdx + 1];
    if (typeof outputPath !== "string" || outputPath.length === 0) {
      throw new Error("missing --output-last-message value");
    }

    // Write the final report eagerly so observeProcess picks it up after
    // process.exited resolves. createPath:true builds the screenshot dir.
    const finalReportReady = Bun.write(outputPath, FINAL_REPORT, {
      createPath: true,
    });

    const stdout = new ReadableStream<Uint8Array>({
      async start(controller) {
        await finalReportReady;
        controller.enqueue(new TextEncoder().encode(`${STUB_JSONL_EVENTS}\n`));
        controller.close();
      },
    });

    return {
      stdout,
      stderr: null,
      exited: (async () => {
        await finalReportReady;
        return 0;
      })(),
      kill: () => {
        // No-op for the stub.
      },
    };
  };
  return { spawner, spawnedArgs: () => capturedArgs };
}

function makeGoalConfig(runtimeDirectory: string): Config["game"]["goal"] {
  return {
    enabled: true,
    model: "gpt-5.4-nano",
    codex_binary: "/usr/bin/true",
    runtime_directory: runtimeDirectory,
    screenshot_dir: "screenshots",
    state_path: "goal-state.json",
    memory_dir: "goal-memory",
    control_host: "127.0.0.1",
    control_port: 8082,
    max_runtime_minutes: 1,
    lock_minutes: 1,
    progress_update_interval_seconds: 60,
    command_limits: {
      max_quantity_per_action: 60,
      chord_max_commands: 32,
      chord_max_total: 200,
    },
  };
}

async function waitForCondition(
  poll: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (poll()) return;
    await Bun.sleep(10);
  }
  throw new Error("waitForCondition timeout");
}

function collectDisableFlags(args: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--disable") {
      const next = args[i + 1];
      if (typeof next === "string") out.add(next);
    }
  }
  return out;
}

describe("e2e: /goal pipeline (T1–T7 integration)", () => {
  test("end-to-end: codex args, prompt content, cost+history+spans", async () => {
    const runtimeDirectory = await createRuntimeDirectory();
    const messages: GoalDiscordMessage[] = [];
    const { spawner, spawnedArgs } = makeStubSpawner();

    const manager = new GoalManager({
      config: makeGoalConfig(runtimeDirectory),
      controlToken: "stub-token",
      spawner,
      sendMessage: async (m) => {
        messages.push(m);
      },
      snapshotProvider: () => emerald1BadgeSnapshot(),
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    const start = await manager.startGoal({
      goal: "Advance the dialog and walk one tile",
      requesterId: "e2e-user",
      channelId: "e2e-channel",
    });
    expect(start.kind).toBe("started");

    // observeProcess fires asynchronously after exit + persistState.
    await waitForCondition(() => messages.length > 0, 5000);

    // ---- T1: --disable apps/plugins/multi_agent + --json all present ----
    const args = spawnedArgs();
    const disabled = collectDisableFlags(args);
    expect(disabled.has("apps")).toBe(true);
    expect(disabled.has("plugins")).toBe(true);
    expect(disabled.has("multi_agent")).toBe(true);
    expect(args.includes("--json")).toBe(true);

    // ---- T3 + T6: prompt has Emerald primer + game state + chord guidance ----
    const prompt = args.at(-1) ?? "";
    expect(prompt).toContain("Pokémon Emerald");
    expect(prompt).toContain("Treecko"); // from the stubbed snapshot
    expect(prompt).toContain("pokemonctl state"); // T5 pointer
    expect(prompt.toLowerCase()).toContain("chord");

    // ---- T2: Discord message ends with the cost+token line ----
    const finalContent = messages.at(-1)?.content ?? "";
    expect(finalContent).toContain(FINAL_REPORT);
    expect(finalContent).toMatch(/Cost: \$\d/);
    expect(finalContent).toMatch(/Tokens: \S+ in \/ \S+ out/);

    // ---- T4: persisted goal-state.json carries a history entry ----
    const statePath = path.resolve(runtimeDirectory, "goal-state.json");
    const persisted: { current?: unknown; history?: unknown } =
      await Bun.file(statePath).json();
    expect(persisted.current).toBeDefined();
    expect(Array.isArray(persisted.history)).toBe(true);
    const history = Array.isArray(persisted.history) ? persisted.history : [];
    expect(history).toHaveLength(1);
    const entry: { goal?: string; status?: string } = history[0];
    expect(entry.goal).toBe("Advance the dialog and walk one tile");
    expect(entry.status).toBe("completed");

    // ---- T7: spans recorded ----
    const spans = exporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);
    expect(spanNames).toContain("pokemon.goal.run");
    expect(
      spanNames.filter((n) => n === "pokemon.goal.turn").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      spanNames.filter((n) => n === "pokemon.goal.tool").length,
    ).toBeGreaterThanOrEqual(2);
    const turnSpans = spans.filter((s) => s.name === "pokemon.goal.turn");
    for (const span of turnSpans) {
      expect(typeof span.attributes["gen_ai.usage.input_tokens"]).toBe(
        "number",
      );
      expect(typeof span.attributes["gen_ai.usage.output_tokens"]).toBe(
        "number",
      );
    }

    await manager.shutdown();
  });
});

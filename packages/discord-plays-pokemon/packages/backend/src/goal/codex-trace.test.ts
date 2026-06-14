import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { attachCodexTrace } from "./codex-trace.ts";
import { createCodexJsonlParser } from "./codex-jsonl.ts";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeEach(() => {
  trace.setGlobalTracerProvider(provider);
  exporter.reset();
});

afterEach(() => {
  trace.disable();
});

const baseOptions = {
  goalId: "goal-123",
  goal: "Reach Petalburg",
  model: "gpt-5.4-nano",
  requestedBy: "user-a",
  gameStateSummary: "Party: Treecko L5",
  initialPrompt: "goal=Reach Petalburg",
};

describe("attachCodexTrace", () => {
  test("opens a pokemon.goal.run root span on attach + ends it on end()", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    codexTrace.end();

    const root = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pokemon.goal.run");
    expect(root).toBeDefined();
    expect(root?.attributes["pokemon.goal.id"]).toBe("goal-123");
    expect(root?.attributes["pokemon.goal.text"]).toBe("Reach Petalburg");
    expect(root?.attributes["gen_ai.system"]).toBe("openai");
    expect(root?.attributes["gen_ai.request.model"]).toBe("gpt-5.4-nano");
  });

  test("creates a pokemon.goal.turn child span per turn.started/completed pair", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    parser.push(
      [
        `{"type":"turn.started"}`,
        `{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"hello world"}}`,
        `{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":25}}`,
        "",
      ].join("\n"),
    );
    codexTrace.end();

    const turn = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pokemon.goal.turn");
    expect(turn).toBeDefined();
    expect(turn?.attributes["gen_ai.usage.input_tokens"]).toBe(1000);
    expect(turn?.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(200);
    // Output + reasoning combined into output_tokens (matches OTel semconv).
    expect(turn?.attributes["gen_ai.usage.output_tokens"]).toBe(75);
    expect(turn?.attributes["gen_ai.usage.reasoning_tokens"]).toBe(25);
    expect(turn?.attributes["gen_ai.output.messages"]).toBe(
      JSON.stringify(["hello world"]),
    );
  });

  test("first turn carries the initial prompt as gen_ai.input.messages", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    parser.push(
      `{"type":"turn.started"}\n{"type":"turn.completed","usage":{"input_tokens":1}}\n`,
    );
    codexTrace.end();

    const turn = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pokemon.goal.turn");
    expect(turn?.attributes["gen_ai.input.messages"]).toBe(
      "goal=Reach Petalburg",
    );
  });

  test("opens a pokemon.goal.tool span per ExecCommandBegin/End pair", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    parser.push(
      [
        `{"type":"ExecCommandBegin","call_id":"call-1","command":["pokemonctl","press","a"]}`,
        `{"type":"ExecCommandEnd","call_id":"call-1","exit_code":0,"stdout":"ok","stderr":""}`,
        "",
      ].join("\n"),
    );
    codexTrace.end();

    const tool = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pokemon.goal.tool");
    expect(tool).toBeDefined();
    expect(tool?.attributes["pokemon.tool.command"]).toBe("pokemonctl press a");
    expect(tool?.attributes["pokemon.tool.exit_code"]).toBe(0);
    expect(tool?.attributes["pokemon.tool.stdout_snippet"]).toBe("ok");
  });

  test("end() closes mid-flight turn + tool spans (codex died unexpectedly)", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    parser.push(
      [
        `{"type":"turn.started"}`,
        `{"type":"ExecCommandBegin","call_id":"call-1","command":"pokemonctl screenshot"}`,
        "",
      ].join("\n"),
    );
    // Don't send turn.completed / ExecCommandEnd — codex was killed.
    codexTrace.end();

    const names = exporter
      .getFinishedSpans()
      .map((s) => s.name)
      .toSorted();
    expect(names).toContain("pokemon.goal.run");
    expect(names).toContain("pokemon.goal.turn");
    expect(names).toContain("pokemon.goal.tool");
  });

  test("end() is idempotent (called from multiple terminal paths)", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);
    codexTrace.end();
    expect(() => {
      codexTrace.end();
    }).not.toThrow();
  });

  test("a malformed JSONL line lands as a span event on the root span", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    parser.push("not json at all\n");
    codexTrace.end();

    const root = exporter
      .getFinishedSpans()
      .find((s) => s.name === "pokemon.goal.run");
    expect(root?.events.map((e) => e.name)).toContain("codex.parse_error");
  });

  test("ignores tool events without matching ExecCommandBegin", () => {
    const parser = createCodexJsonlParser();
    const codexTrace = attachCodexTrace(parser, baseOptions);

    // ExecCommandEnd with a call_id we never opened — should not crash, should
    // not produce a phantom tool span.
    parser.push(`{"type":"ExecCommandEnd","call_id":"ghost","exit_code":0}\n`);
    codexTrace.end();

    const tools = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "pokemon.goal.tool");
    expect(tools).toHaveLength(0);
  });
});

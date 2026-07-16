import { test, expect, beforeAll } from "bun:test";
import { createCodexJsonlParser, type CodexEvent } from "#src/codex-jsonl.ts";
import { attachCodexTrace } from "#src/codex-trace.ts";
import { exporter } from "./otel-test-provider.ts";

// Real `codex exec --json` output captured 2026-07-04 (codex-cli 0.142.5).
let codexFixture = "";
beforeAll(async () => {
  codexFixture = await Bun.file(
    new URL("../fixtures/codex-exec.jsonl", import.meta.url),
  ).text();
});

test("parser accumulates usage totals from the real fixture", () => {
  const parser = createCodexJsonlParser();
  const events: CodexEvent[] = [];
  parser.subscribe((event) => events.push(event));
  parser.push(codexFixture);
  parser.finish();

  expect(events.map((e) => e.kind)).toEqual([
    "other", // thread.started
    "turn.started",
    "agent_message",
    "turn.completed",
  ]);
  expect(parser.total()).toEqual({
    inputTokens: 22_623,
    cachedInputTokens: 22_400,
    outputTokens: 70,
    reasoningOutputTokens: 63,
  });
});

test("parser handles chunked pushes across line boundaries", () => {
  const parser = createCodexJsonlParser();
  const events: CodexEvent[] = [];
  parser.subscribe((event) => events.push(event));
  const mid = Math.floor(codexFixture.length / 2);
  parser.push(codexFixture.slice(0, mid));
  parser.push(codexFixture.slice(mid));
  parser.finish();
  expect(events.filter((e) => e.kind === "turn.completed").length).toBe(1);
});

test("attachCodexTrace emits run + turn spans with gen_ai attributes", () => {
  exporter.reset();
  const parser = createCodexJsonlParser();
  const codexTrace = attachCodexTrace(parser, {
    service: "temporal",
    callSite: "agent-task",
    model: "gpt-5.2-codex",
    initialPrompt: "do the thing",
  });
  parser.push(codexFixture);
  parser.finish();
  codexTrace.end();

  const spans = exporter.getFinishedSpans();
  const names = spans.map((s) => s.name).toSorted();
  expect(names).toEqual(["codex.agent.run", "codex.agent.turn"]);

  const turn = spans.find((s) => s.name === "codex.agent.turn")!;
  expect(turn.attributes["gen_ai.system"]).toBe("openai");
  expect(turn.attributes["gen_ai.request.model"]).toBe("gpt-5.2-codex");
  expect(turn.attributes["llm.service"]).toBe("temporal");
  expect(turn.attributes["llm.call_site"]).toBe("agent-task");
  expect(turn.attributes["gen_ai.usage.input_tokens"]).toBe(22_623);
  expect(turn.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(22_400);
  // Output folds reasoning tokens in (OpenAI bills reasoning as output).
  expect(turn.attributes["gen_ai.usage.output_tokens"]).toBe(70 + 63);
  expect(turn.attributes["gen_ai.usage.reasoning_tokens"]).toBe(63);
  expect(turn.attributes["gen_ai.input.messages"]).toBe("do the thing");
  expect(turn.attributes["gen_ai.output.messages"]).toBe(
    JSON.stringify(["pong"]),
  );

  const root = spans.find((s) => s.name === "codex.agent.run")!;
  expect(root.attributes["gen_ai.system"]).toBe("openai");
  expect(root.attributes["llm.call_site"]).toBe("agent-task");
});

test("attachCodexTrace honors span prefix, root attrs, and tool events", () => {
  exporter.reset();
  const parser = createCodexJsonlParser();
  const codexTrace = attachCodexTrace(parser, {
    service: "discord-plays-pokemon",
    callSite: "goal-run",
    model: "gpt-5.2",
    spanPrefix: "pokemon.goal",
    toolAttributePrefix: "pokemon.tool",
    rootAttributes: { "pokemon.goal.id": "goal-42" },
  });

  const lines = [
    { type: "turn.started" },
    { type: "ExecCommandBegin", call_id: "c1", command: ["ls", "-la"] },
    { type: "ExecCommandEnd", call_id: "c1", exit_code: 0, stdout: "files" },
    {
      type: "turn.completed",
      usage: { input_tokens: 5, output_tokens: 2 },
    },
  ];
  parser.push(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  codexTrace.end();

  const spans = exporter.getFinishedSpans();
  const names = spans.map((s) => s.name).toSorted();
  expect(names).toEqual([
    "pokemon.goal.run",
    "pokemon.goal.tool",
    "pokemon.goal.turn",
  ]);

  const tool = spans.find((s) => s.name === "pokemon.goal.tool")!;
  expect(tool.attributes["pokemon.tool.command"]).toBe("ls -la");
  expect(tool.attributes["pokemon.tool.exit_code"]).toBe(0);
  expect(tool.attributes["pokemon.tool.stdout_snippet"]).toBe("files");

  // Turn index keeps dpp's historical attribute name (prefix-derived).
  const turn = spans.find((s) => s.name === "pokemon.goal.turn")!;
  expect(turn.attributes["pokemon.goal.turn_index"]).toBe(1);

  const root = spans.find((s) => s.name === "pokemon.goal.run")!;
  expect(root.attributes["pokemon.goal.id"]).toBe("goal-42");
});

test("end() is idempotent and closes dangling turn/tool spans", () => {
  exporter.reset();
  const parser = createCodexJsonlParser();
  const codexTrace = attachCodexTrace(parser, {
    service: "temporal",
    callSite: "agent-task",
    model: "gpt-5.2-codex",
  });
  // Turn starts, tool opens, then codex dies — no completion events.
  parser.push(
    `${JSON.stringify({ type: "turn.started" })}\n${JSON.stringify({
      type: "ExecCommandBegin",
      call_id: "c9",
      command: "sleep 999",
    })}\n`,
  );
  codexTrace.end();
  codexTrace.end();

  const spans = exporter.getFinishedSpans();
  // run + dangling turn + dangling tool, each ended exactly once.
  expect(spans.length).toBe(3);
});

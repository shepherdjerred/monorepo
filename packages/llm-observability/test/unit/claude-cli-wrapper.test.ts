import { test, expect, beforeAll } from "bun:test";
import { SpanStatusCode } from "@opentelemetry/api";
import { hrTimeToMilliseconds } from "@opentelemetry/core";
import { traceClaudeCli, parseCliStdout } from "#src/claude-cli-wrapper.ts";
import { exporter } from "./otel-test-provider.ts";

// Real CLI output captured 2026-07-04 (claude 2.1.187, haiku, "reply pong").
let streamJsonFixture = "";
let jsonFixture = "";
beforeAll(async () => {
  streamJsonFixture = await Bun.file(
    new URL("../fixtures/claude-stream-json.ndjson", import.meta.url),
  ).text();
  jsonFixture = await Bun.file(
    new URL("../fixtures/claude-json.json", import.meta.url),
  ).text();
});

const metadata = {
  service: "temporal",
  callSite: "agent-task",
  request: {
    model: undefined,
    prompt: "Reply with exactly: pong",
    options: { maxTurns: 1 },
  },
};

test("traceClaudeCli parses stream-json stdout into a gen_ai.chat span", () => {
  exporter.reset();
  traceClaudeCli(metadata, {
    stdout: streamJsonFixture,
    exitCode: 0,
    startTimeMs: 1_700_000_000_000,
    endTimeMs: 1_700_000_010_000,
  });

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  const span = spans[0]!;
  expect(span.name).toBe("gen_ai.chat");
  expect(span.attributes["gen_ai.system"]).toBe("claude_code_cli");
  expect(span.attributes["llm.service"]).toBe("temporal");
  expect(span.attributes["llm.call_site"]).toBe("agent-task");
  // Model falls back to the stream's system/init message.
  expect(span.attributes["gen_ai.request.model"]).toBe(
    "claude-haiku-4-5-20251001",
  );
  // Usage from the terminal result message (real captured values).
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(44);
  expect(span.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(
    21_090,
  );
  expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(16_651);
  expect(span.attributes["llm.cost_usd"]).toBe(0.028_257_6);
  expect(span.attributes["llm.claude_code.num_turns"]).toBe(1);
  expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual([
    "end_turn",
  ]);
  expect(span.attributes["llm.cli.parse_error"]).toBeUndefined();
  expect(typeof span.attributes["gen_ai.input.messages"]).toBe("string");
  expect(typeof span.attributes["gen_ai.output.messages"]).toBe("string");
  expect(span.status.code).toBe(SpanStatusCode.OK);
  // Post-hoc timing: the span reflects the subprocess wall-clock bounds.
  expect(hrTimeToMilliseconds(span.startTime)).toBe(1_700_000_000_000);
  expect(hrTimeToMilliseconds(span.endTime)).toBe(1_700_000_010_000);
});

test("traceClaudeCli parses --output-format json stdout", () => {
  exporter.reset();
  traceClaudeCli(
    {
      service: "temporal",
      callSite: "homelab-audit",
      request: {
        model: "claude-haiku-4-5",
        prompt: "audit",
        options: undefined,
      },
    },
    {
      stdout: jsonFixture,
      exitCode: 0,
      startTimeMs: 1_700_000_000_000,
      endTimeMs: 1_700_000_005_000,
    },
  );

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  const span = spans[0]!;
  // Explicit metadata model wins over stream init (json format has none).
  expect(span.attributes["gen_ai.request.model"]).toBe("claude-haiku-4-5");
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(10);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(51);
  expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(37_741);
  expect(span.attributes["llm.cost_usd"]).toBe(0.004_039_1);
  expect(span.status.code).toBe(SpanStatusCode.OK);
});

test("traceClaudeCli flags unparseable stdout without throwing", () => {
  exporter.reset();
  traceClaudeCli(metadata, {
    stdout: "not json at all\nstill not json",
    exitCode: 1,
    startTimeMs: 1_700_000_000_000,
    endTimeMs: 1_700_000_001_000,
  });

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  const span = spans[0]!;
  expect(span.attributes["llm.cli.parse_error"]).toBe(true);
  expect(span.attributes["llm.cli.exit_code"]).toBe(1);
  // Input body is still archived even when the output is unusable.
  expect(typeof span.attributes["gen_ai.input.messages"]).toBe("string");
  expect(span.attributes["gen_ai.output.messages"]).toBeUndefined();
  expect(span.status.code).toBe(SpanStatusCode.ERROR);
});

test("traceClaudeCli marks is_error results as ERROR even with exit 0", () => {
  exporter.reset();
  const errorResult = JSON.stringify({
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    num_turns: 10,
  });
  traceClaudeCli(metadata, {
    stdout: errorResult,
    exitCode: 0,
    startTimeMs: 1_700_000_000_000,
    endTimeMs: 1_700_000_001_000,
  });

  const spans = exporter.getFinishedSpans();
  const span = spans[0]!;
  expect(span.status.code).toBe(SpanStatusCode.ERROR);
  expect(span.status.message).toBe("error_max_turns");
});

test("parseCliStdout tolerates non-JSON noise between NDJSON lines", () => {
  const noisy = [
    "some hook printed this",
    JSON.stringify({ type: "system", subtype: "init", model: "m1" }),
    "",
    JSON.stringify({ type: "result", subtype: "success", result: "done" }),
  ].join("\n");
  const parsed = parseCliStdout(noisy);
  expect(parsed.initModel).toBe("m1");
  expect(parsed.result?.result).toBe("done");
  expect(parsed.parseError).toBe(false);
});

test("parseCliStdout parses pretty-printed whole-buffer JSON", () => {
  const pretty = JSON.stringify(
    { type: "result", subtype: "success", result: "ok" },
    null,
    2,
  );
  const parsed = parseCliStdout(pretty);
  expect(parsed.result?.result).toBe("ok");
  expect(parsed.parseError).toBe(false);
});

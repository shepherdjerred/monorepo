import { trace } from "@opentelemetry/api";
import { test, expect } from "vitest";
import { traceClaudeAgent } from "#src/claude-agent-wrapper.ts";
import { exporter } from "./otel-test-provider.ts";
import { Registry } from "prom-client";

async function* fakeQuery(): AsyncGenerator {
  yield {
    type: "system",
    subtype: "init",
    model: "claude-sonnet-4-6",
    session_id: "sess-1",
  };
  yield {
    type: "assistant",
    message: { content: [{ type: "text", text: "thinking" }] },
    session_id: "sess-1",
  };
  yield {
    type: "assistant",
    message: { content: [{ type: "text", text: "done" }] },
    session_id: "sess-1",
  };
  yield {
    type: "result",
    subtype: "success",
    result: "done",
    stop_reason: "end_turn",
    is_error: false,
    num_turns: 2,
    total_cost_usd: 0.0012,
    session_id: "sess-1",
    usage: {
      input_tokens: 200,
      output_tokens: 30,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 15,
    },
  };
}

test("traceClaudeAgent accumulates assistant messages and result usage", async () => {
  exporter.reset();
  const metricsRegister = new Registry();
  const yielded: unknown[] = [];

  for await (const msg of traceClaudeAgent(
    {
      service: "birmel",
      callSite: "editor-claude",
      metricsRegister,
      request: {
        model: undefined,
        prompt: "edit this file",
        options: { permissionMode: "default" },
      },
    },
    fakeQuery,
  )) {
    yielded.push(msg);
  }

  expect(yielded.length).toBe(4);
  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  const span = spans[0]!;
  expect(span.attributes["gen_ai.system"]).toBe("claude_code_sdk");
  expect(span.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-6");
  expect(span.attributes["gen_ai.response.model"]).toBe("claude-sonnet-4-6");
  expect(span.attributes["gen_ai.response.id"]).toBe("sess-1");
  expect(span.attributes["llm.claude_code.session_id"]).toBe("sess-1");
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(200);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(30);
  expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(50);
  expect(span.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(15);
  expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual([
    "end_turn",
  ]);
  // Retained on the span as a provider-reported fact, and useful when reading
  // one trace, but it is a subscription-equivalent API price rather than cash.
  expect(span.attributes["llm.cost_usd"]).toBe(0.0012);
  expect(span.attributes["llm.claude_code.num_turns"]).toBe(2);
  const outputs = JSON.parse(
    String(span.attributes["gen_ai.output.messages"] ?? "[]"),
  );
  expect(outputs.length).toBe(2);

  const metrics = await metricsRegister.metrics();
  expect(metrics).toContain('provider="claude_agent_sdk"');
  expect(metrics).toContain('model="claude-sonnet-4-6"');
  expect(metrics).toContain('outcome="success"');
  // The Claude Agent SDK bills against a subscription, so it contributes token
  // samples but must never contribute a cost sample. The counter itself stays
  // registered because the OpenRouter path shares it; what must be absent is any
  // `llm_cost_usd_total` series carrying this transport's labels.
  expect(metrics).toContain('type="cached_input"');
  expect(metrics).not.toMatch(/^llm_cost_usd_total\{/m);
});

test("traceClaudeAgent runs SDK iteration beneath its repository-owned span", async () => {
  exporter.reset();
  let activeSpanId: string | undefined;
  async function* contextQuery(): AsyncGenerator {
    activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
    yield {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
    };
  }

  for await (const message of traceClaudeAgent(
    {
      service: "temporal",
      callSite: "agent-task",
      request: { model: "claude-opus-5", prompt: "work", options: undefined },
    },
    contextQuery,
  )) {
    void message;
  }

  const root = exporter
    .getFinishedSpans()
    .find((span) => span.name === "gen_ai.chat");
  expect(root).toBeDefined();
  expect(activeSpanId).toBe(root?.spanContext().spanId);
});

test("traceClaudeAgent closes its span when SDK iterator cleanup fails", async () => {
  exporter.reset();
  const cleanupError = new Error("SDK cleanup failed");
  const iterable: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      let yielded = false;
      return {
        next() {
          if (yielded) return Promise.resolve({ done: true, value: undefined });
          yielded = true;
          return Promise.resolve({ done: false, value: { type: "assistant" } });
        },
        return() {
          return Promise.reject(cleanupError);
        },
      };
    },
  };

  await expect(
    (async () => {
      for await (const message of traceClaudeAgent(
        {
          service: "temporal",
          callSite: "agent-task",
          request: {
            model: "claude-opus-5",
            prompt: "work",
            options: undefined,
          },
        },
        () => iterable,
      )) {
        void message;
        break;
      }
    })(),
  ).rejects.toThrow("SDK cleanup failed");

  const root = exporter
    .getFinishedSpans()
    .find((span) => span.name === "gen_ai.chat");
  expect(root?.status.code).toBe(2);
});

import { test, expect, beforeAll, afterAll } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace } from "@opentelemetry/api";
import { traceAnthropic } from "#src/anthropic-wrapper.ts";
import { traceOpenAi } from "#src/openai-wrapper.ts";
import { traceGemini } from "#src/gemini-wrapper.ts";
import { traceClaudeAgent } from "#src/claude-agent-wrapper.ts";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "test-service" }),
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
});

test("traceAnthropic emits gen_ai.* attributes with usage", async () => {
  exporter.reset();
  const response = await traceAnthropic(
    {
      service: "temporal",
      callSite: "pr-summary",
      request: {
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: "summarize" }],
        system: "you are a helpful assistant",
      },
    },
    async () => ({
      id: "msg_test123",
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 100,
        output_tokens: 25,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    }),
  );
  expect(response.id).toBe("msg_test123");

  const spans = exporter.getFinishedSpans();
  expect(spans.length).toBe(1);
  const span = spans[0]!;
  expect(span.name).toBe("gen_ai.chat");
  expect(span.attributes["gen_ai.system"]).toBe("anthropic");
  expect(span.attributes["gen_ai.request.model"]).toBe("claude-haiku-4-5");
  expect(span.attributes["gen_ai.response.model"]).toBe(
    "claude-haiku-4-5-20251001",
  );
  expect(span.attributes["gen_ai.response.id"]).toBe("msg_test123");
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(100);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(25);
  expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(10);
  expect(span.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(5);
  expect(span.attributes["llm.service"]).toBe("temporal");
  expect(span.attributes["llm.call_site"]).toBe("pr-summary");
  expect(typeof span.attributes["gen_ai.input.messages"]).toBe("string");
  expect(typeof span.attributes["gen_ai.output.messages"]).toBe("string");
});

test("traceOpenAi extracts prompt/completion tokens from chat.completions.create", async () => {
  exporter.reset();
  await traceOpenAi(
    {
      service: "scout-backend",
      callSite: "scout-review",
      request: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "summary" },
        ],
        max_tokens: 256,
        temperature: 0.7,
      },
    },
    async () => ({
      id: "chatcmpl-abc",
      model: "gpt-4o-mini-2024-07-18",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 5,
        total_tokens: 47,
        prompt_tokens_details: { cached_tokens: 7 },
      },
    }),
  );

  const span = exporter.getFinishedSpans()[0]!;
  expect(span.attributes["gen_ai.system"]).toBe("openai");
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(42);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(5);
  expect(span.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(7);
  expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
  expect(span.attributes["gen_ai.request.temperature"]).toBe(0.7);
  expect(span.attributes["gen_ai.request.max_tokens"]).toBe(256);
});

test("traceGemini extracts usage from usageMetadata", async () => {
  exporter.reset();
  await traceGemini(
    {
      service: "scout-backend",
      callSite: "scout-review",
      request: {
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: "summarize" }] }],
      },
    },
    async () => ({
      response: {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "ok" }] },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 3,
          totalTokenCount: 15,
          cachedContentTokenCount: 0,
        },
        modelVersion: "gemini-2.0-flash-001",
        responseId: "resp-1",
      },
    }),
  );
  const span = exporter.getFinishedSpans()[0]!;
  expect(span.attributes["gen_ai.system"]).toBe("gemini");
  expect(span.attributes["gen_ai.request.model"]).toBe("gemini-2.0-flash");
  expect(span.attributes["gen_ai.response.model"]).toBe("gemini-2.0-flash-001");
  expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(12);
  expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(3);
  expect(span.attributes["gen_ai.response.finish_reasons"]).toEqual(["STOP"]);
});

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
  const yielded: unknown[] = [];

  for await (const msg of traceClaudeAgent(
    {
      service: "birmel",
      callSite: "editor-claude",
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
  expect(span.attributes["llm.cost_usd"]).toBe(0.0012);
  expect(span.attributes["llm.claude_code.num_turns"]).toBe(2);
  const outputs = JSON.parse(
    String(span.attributes["gen_ai.output.messages"] ?? "[]"),
  );
  expect(outputs.length).toBe(2);
});

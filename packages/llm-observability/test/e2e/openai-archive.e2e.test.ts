import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { setupServer, type SetupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { trace, context } from "@opentelemetry/api";
import {
  buildE2eHarness,
  pollTempoTrace,
  getMinioObject,
  gunzipJson,
  type E2eHarness,
} from "./helpers.ts";
import { traceOpenAi } from "../../src/openai-wrapper.ts";

let server: SetupServer;
let harness: E2eHarness;

beforeAll(() => {
  server = setupServer(
    http.post("https://api.openai.com/v1/chat/completions", () =>
      HttpResponse.json({
        id: "chatcmpl-e2e-1",
        object: "chat.completion",
        created: 1715800000,
        model: "gpt-4o-mini-2024-07-18",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi back" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      }),
    ),
  );
  server.listen({ onUnhandledRequest: "bypass" });
  harness = buildE2eHarness("e2e-test-openai");
});

beforeEach(() => {
  server.resetHandlers(
    http.post("https://api.openai.com/v1/chat/completions", () =>
      HttpResponse.json({
        id: "chatcmpl-e2e-1",
        object: "chat.completion",
        created: 1715800000,
        model: "gpt-4o-mini-2024-07-18",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi back" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      }),
    ),
  );
});

afterAll(async () => {
  server.close();
  await harness.shutdown();
});

test("end-to-end: OpenAI call -> Tempo span + MinIO archive", async () => {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: "sk-test-not-real" });

  let capturedTraceId = "";
  let capturedSpanId = "";

  const response = await traceOpenAi(
    {
      service: "e2e-test-openai",
      callSite: "scout-review",
      request: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "say hi" },
        ],
        max_tokens: 256,
      },
    },
    async () => {
      const ctx = trace.getSpan(context.active())?.spanContext();
      if (ctx !== undefined) {
        capturedTraceId = ctx.traceId;
        capturedSpanId = ctx.spanId;
      }
      return client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "say hi" },
        ],
      });
    },
  );

  expect(response.id).toBe("chatcmpl-e2e-1");
  expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
  expect(capturedSpanId).toMatch(/^[0-9a-f]{16}$/);

  await harness.flush();

  const traceResult = await pollTempoTrace(capturedTraceId);
  const llmSpan = traceResult.spans.find((s) => s.name === "gen_ai.chat");
  expect(llmSpan).toBeDefined();
  expect(llmSpan?.attributes["gen_ai.system"]).toBe("openai");
  expect(llmSpan?.attributes["gen_ai.request.model"]).toBe("gpt-4o-mini");
  expect(llmSpan?.attributes["gen_ai.usage.input_tokens"]).toBe(7);
  expect(llmSpan?.attributes["gen_ai.usage.output_tokens"]).toBe(2);
  expect(llmSpan?.attributes["gen_ai.response.finish_reasons"]).toContain(
    "stop",
  );
  expect(llmSpan?.attributes["llm.archive.status"]).toBe("ok");
  expect(llmSpan?.attributes["llm.archive.s3_bucket"]).toBe("llm-archive");
  expect(llmSpan?.attributes["gen_ai.input.messages"]).toBeUndefined();
  expect(llmSpan?.attributes["gen_ai.output.messages"]).toBeUndefined();

  const s3Key = llmSpan?.attributes["llm.archive.s3_key"];
  expect(typeof s3Key).toBe("string");
  if (typeof s3Key !== "string") throw new Error("missing s3_key");

  const archived = await getMinioObject("llm-archive", s3Key);
  const envelope = gunzipJson(archived);
  expect(envelope).toMatchObject({
    v: 1,
    service: "e2e-test-openai",
    provider: "openai",
    callSite: "scout-review",
  });
  const inputMessages = (envelope as { "gen_ai.input.messages": unknown })[
    "gen_ai.input.messages"
  ];
  expect(inputMessages).toEqual([
    { role: "system", content: "be brief" },
    { role: "user", content: "say hi" },
  ]);
});

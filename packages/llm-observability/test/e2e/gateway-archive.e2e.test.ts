import { afterAll, beforeAll, expect, test } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { z } from "zod";
import {
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
} from "#src/span-helpers.ts";
import {
  buildE2eHarness,
  getMinioObject,
  gunzipJson,
  pollTempoTrace,
  type E2eHarness,
} from "./helpers.ts";

const InputMessagesEnvelopeSchema = z.object({
  "gen_ai.input.messages": z.array(
    z.object({ role: z.string(), content: z.string() }),
  ),
});

let harness: E2eHarness;

beforeAll(() => {
  harness = buildE2eHarness("e2e-test-openrouter");
});

afterAll(async () => {
  await harness.shutdown();
});

test("end-to-end: gateway span -> Tempo + private archive", async () => {
  let capturedTraceId = "";
  let capturedSpanId = "";

  const response = await withLlmSpan(
    {
      service: "e2e-test-openrouter",
      callSite: "scout-review",
      system: "openrouter",
    },
    {
      model: "openai/gpt-5.4-mini",
      maxTokens: 256,
      temperature: undefined,
      topP: undefined,
      stopSequences: undefined,
    },
    async (span) => {
      const spanContext = trace.getSpan(context.active())?.spanContext();
      if (spanContext !== undefined) {
        capturedTraceId = spanContext.traceId;
        capturedSpanId = spanContext.spanId;
      }
      span.setAttributes({
        "gen_ai.input.messages": serializeBodyAttribute([
          { role: "system", content: "be brief" },
          { role: "user", content: "say hi" },
        ]),
        "gen_ai.output.messages": serializeBodyAttribute([
          { role: "assistant", content: "hi back" },
        ]),
      });
      setLlmResponseAttributes(span, {
        model: "openai/gpt-5.4-mini",
        id: "gen-e2e-1",
        finishReasons: ["stop"],
        inputTokens: 7,
        outputTokens: 2,
        cacheReadInputTokens: undefined,
        cacheCreationInputTokens: undefined,
      });
      return { id: "gen-e2e-1" };
    },
  );

  expect(response.id).toBe("gen-e2e-1");
  expect(capturedTraceId).toMatch(/^[0-9a-f]{32}$/);
  expect(capturedSpanId).toMatch(/^[0-9a-f]{16}$/);

  await harness.flush();

  const traceResult = await pollTempoTrace(capturedTraceId);
  const llmSpan = traceResult.spans.find((span) => span.name === "gen_ai.chat");
  expect(llmSpan).toBeDefined();
  expect(llmSpan?.attributes["gen_ai.system"]).toBe("openrouter");
  expect(llmSpan?.attributes["gen_ai.request.model"]).toBe(
    "openai/gpt-5.4-mini",
  );
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
    service: "e2e-test-openrouter",
    provider: "openrouter",
    callSite: "scout-review",
  });
  const parsedEnvelope = InputMessagesEnvelopeSchema.parse(envelope);
  expect(parsedEnvelope["gen_ai.input.messages"]).toEqual([
    { role: "system", content: "be brief" },
    { role: "user", content: "say hi" },
  ]);
});

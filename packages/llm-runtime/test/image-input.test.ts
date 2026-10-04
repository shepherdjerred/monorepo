import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createLlmRuntime,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";
import { assertImageInput } from "#src/validated-object.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function responsesBody(text: string) {
  return {
    id: "resp_test",
    object: "response",
    model: "gpt-5.6-luna",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 4,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 16,
    },
  };
}

function capturingRuntime(replies: readonly string[]) {
  const bodies: unknown[] = [];
  const llm = createLlmRuntime({
    credentials: {
      openai: { apiKey: "sk-test" },
      anthropic: { kind: "apiKey", apiKey: "sk-ant-test" },
      google: { apiKey: "test-gemini-key" },
    },
    service: "runtime-test",
    appName: "Runtime Test",
    fetch: (_input, init) => {
      const body = init?.body;
      if (typeof body !== "string") throw new Error("expected a JSON body");
      bodies.push(JSON.parse(body));
      const reply = replies[bodies.length - 1] ?? replies.at(-1) ?? "{}";
      return Promise.resolve(Response.json(responsesBody(reply)));
    },
  });
  return { llm, bodies };
}

const ContentSchema = z.looseObject({ type: z.string() });
const RequestSchema = z.looseObject({
  input: z.array(z.looseObject({ content: z.array(ContentSchema) })),
});

function userContent(body: unknown) {
  return RequestSchema.parse(body).input.flatMap((item) => item.content);
}

describe("generateValidatedObject with images", () => {
  test("sends images as parts of one user message after the prompt", async () => {
    const { llm, bodies } = capturingRuntime([JSON.stringify({ answer: "a" })]);
    const result = await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: z.object({ answer: z.string() }),
      schemaName: "answer",
      prompt: "which render is better?",
      images: [
        { data: PNG, mediaType: "image/png" },
        { data: PNG, mediaType: "image/png" },
      ],
      workload: "test.images",
    });
    expect(result.object).toEqual({ answer: "a" });
    const content = userContent(bodies[0]);
    expect(content.map((part) => part.type)).toEqual([
      "input_text",
      "input_image",
      "input_image",
    ]);
    expect(JSON.stringify(content[1])).toContain("data:image/png;base64,");
  });

  test("keeps the images on a semantic retry and appends the correction", async () => {
    const { llm, bodies } = capturingRuntime([
      JSON.stringify({ wrong: 1 }),
      JSON.stringify({ answer: "b" }),
    ]);
    const result = await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: z.object({ answer: z.string() }),
      schemaName: "answer",
      prompt: "which render is better?",
      images: [{ data: PNG, mediaType: "image/png" }],
      workload: "test.images.retry",
    });
    expect(result.object).toEqual({ answer: "b" });
    const retry = userContent(bodies[1]);
    expect(retry.map((part) => part.type)).toEqual([
      "input_text",
      "input_image",
    ]);
    expect(JSON.stringify(retry[0])).toContain("failed schema validation");
  });

  test("refuses a model without image input before any call", () => {
    expect(() => {
      assertImageInput("text-embedding-3-small");
    }).toThrow("does not accept image input");
    expect(() => {
      assertImageInput("gpt-5.6-luna");
    }).not.toThrow();
  });
});

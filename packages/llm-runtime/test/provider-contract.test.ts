import { embed, generateImage, generateText, streamText, tool } from "ai";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";

type ContractFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function runtime(fetcher: ContractFetch) {
  return createOpenRouterRuntime({
    apiKey: "test-key",
    service: "contract-test",
    appName: "Contract Test",
    fetch: fetcher,
  });
}

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new TypeError("expected a JSON request body");
  }
  return JSON.parse(init.body);
}

function usage() {
  return {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5,
    cost: 0.00005,
    cost_details: { upstream_inference_cost: 0.00004 },
  };
}

describe("AI SDK 7 and OpenRouter provider contracts", () => {
  test("streams text through the attributed OpenRouter transport", async () => {
    let body: unknown;
    const sse = [
      'data: {"id":"gen-stream","model":"openai/gpt-5.6-luna","provider":"Provider A","choices":[{"index":0,"delta":{"role":"assistant","content":"hel"},"finish_reason":null}]}',
      'data: {"id":"gen-stream","model":"openai/gpt-5.6-luna","provider":"Provider A","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5,"cost":0.00005,"cost_details":{"upstream_inference_cost":0.00004}},"openrouter_metadata":{"requested":"openai/gpt-5.6-luna","attempt":1,"attempts":[{"provider":"Provider A","model":"openai/gpt-5.6-luna","status":200}]}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const openRouter = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    });

    const result = streamText({
      model: openRouter.languageModel("gpt-5.6-luna"),
      prompt: "Say hello.",
      ...openRouter.callOptions({ workload: "contract.stream" }),
    });

    expect(await result.text).toBe("hello");
    expect(
      z.object({ model: z.string(), stream: z.literal(true) }).parse(body),
    ).toMatchObject({
      model: "openai/gpt-5.6-luna",
      stream: true,
    });
  });

  test("decodes and executes strict local tool calls", async () => {
    let body: unknown;
    let executedValue: string | undefined;
    const openRouter = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(
        Response.json({
          id: "gen-tool",
          model: "openai/gpt-5.6-luna",
          provider: "Provider A",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "echo",
                      arguments: '{"value":"hello"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: usage(),
        }),
      );
    });

    const result = await generateText({
      model: openRouter.languageModel("gpt-5.6-luna", ["tools"]),
      prompt: "Echo hello.",
      tools: {
        echo: tool({
          description: "Echo a value.",
          inputSchema: z.object({ value: z.string() }),
          strict: true,
          execute: ({ value }) => {
            executedValue = value;
            return { value };
          },
        }),
      },
      ...openRouter.callOptions({ workload: "contract.tools" }),
    });

    expect(executedValue).toBe("hello");
    expect(result.toolCalls[0]?.toolName).toBe("echo");
    const parsed = z
      .object({
        provider: z.object({ require_parameters: z.literal(true) }).loose(),
        tools: z.array(
          z.object({
            type: z.literal("function"),
            function: z.object({
              name: z.literal("echo"),
              strict: z.literal(true),
            }),
          }),
        ),
      })
      .loose()
      .parse(body);
    expect(parsed.tools).toHaveLength(1);
  });

  test("embeds text through the catalog embedding endpoint", async () => {
    let body: unknown;
    const openRouter = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(
        Response.json({
          id: "embed-1",
          object: "list",
          model: "openai/text-embedding-3-small",
          provider: "Provider A",
          data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
          usage: { prompt_tokens: 2, total_tokens: 2, cost: 0.000001 },
        }),
      );
    });

    const result = await embed({
      model: openRouter.embeddingModel("text-embedding-3-small"),
      value: "hello",
      ...openRouter.callOptions({ workload: "contract.embedding" }),
    });

    expect(result.embedding).toEqual([0.1, 0.2]);
    expect(result.usage.tokens).toBe(2);
    expect(
      z
        .object({
          model: z.literal("openai/text-embedding-3-small"),
          input: z.array(z.literal("hello")),
          provider: z.object({ data_collection: z.literal("deny") }).loose(),
        })
        .parse(body),
    ).toBeDefined();
  });

  test("generates images through the catalog image endpoint", async () => {
    let body: unknown;
    const openRouter = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(
        Response.json({
          created: 1,
          data: [{ b64_json: "AQID" }],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 1,
            total_tokens: 4,
          },
        }),
      );
    });
    const { headers } = openRouter.callOptions({
      workload: "contract.image",
    });

    const result = await generateImage({
      model: openRouter.imageModel("gemini-2.5-flash-image"),
      prompt: "A tiny test image.",
      headers,
    });

    expect(result.image.base64).toBe("AQID");
    expect(
      z
        .object({
          model: z.literal("google/gemini-2.5-flash-image"),
          prompt: z.literal("A tiny test image."),
          provider: z.object({ data_collection: z.literal("deny") }).loose(),
          trace: z.object({
            generation_name: z.literal("contract.image"),
          }),
        })
        .parse(body),
    ).toBeDefined();
  });

  test("propagates cancellation to the provider fetch", async () => {
    let observedAbort = false;
    const openRouter = runtime((_input, init) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        throw new Error("expected an abort signal");
      }
      return new Promise((_resolve, reject) => {
        const rejectCancelled = (): void => {
          observedAbort = true;
          reject(new Error("provider fetch cancelled"));
        };
        if (signal.aborted) {
          rejectCancelled();
          return;
        }
        signal.addEventListener("abort", rejectCancelled, { once: true });
      });
    });

    await expect(
      generateText({
        model: openRouter.languageModel("gpt-5.6-luna"),
        prompt: "Wait.",
        abortSignal: AbortSignal.timeout(5),
        maxRetries: 0,
        ...openRouter.callOptions({ workload: "contract.cancel" }),
      }),
    ).rejects.toThrow();
    expect(observedAbort).toBe(true);
  });
});

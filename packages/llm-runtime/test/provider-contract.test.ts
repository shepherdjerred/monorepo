import { embed, generateText, streamText, tool } from "ai";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createLlmRuntime,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";

type ContractFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function runtime(fetcher: ContractFetch) {
  return createLlmRuntime({
    credentials: { openai: { apiKey: "sk-test" } },
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

/** Request URL without stringifying a Request/URL object by coercion. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** OpenAI Responses API usage, which is what `languageModel()` speaks. */
function responsesUsage() {
  return {
    input_tokens: 12,
    input_tokens_details: { cached_tokens: 4, cache_write_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 2 },
    total_tokens: 17,
  };
}

function textResponse(text: string): Response {
  return Response.json({
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
    usage: responsesUsage(),
  });
}

describe("AI SDK 7 first-party provider contracts", () => {
  test("generates text against OpenAI's Responses API", async () => {
    let url: string | undefined;
    let body: unknown;
    const llm = runtime((input, init) => {
      url = requestUrl(input);
      body = requestBody(init);
      return Promise.resolve(textResponse("hello"));
    });

    const result = await generateText({
      model: llm.languageModel("gpt-5.6-luna"),
      prompt: "hi",
      ...llm.callOptions({ workload: "contract.text" }),
    });

    expect(result.text).toBe("hello");
    // The catalog's native route id is the API model name; no gateway prefix.
    expect(body).toMatchObject({ model: "gpt-5.6-luna" });
    expect(url).toContain("api.openai.com");
    expect(url).not.toContain("openrouter");
    // Cache reads arrive as a separate, non-overlapping count.
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(4);
  });

  test("streams text", async () => {
    const sse = [
      'data: {"type":"response.created","response":{"id":"resp_stream","object":"response","model":"gpt-5.6-luna","status":"in_progress","output":[]}}',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","status":"in_progress","content":[]}}',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hel"}',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"lo"}',
      `data: {"type":"response.completed","response":{"id":"resp_stream","object":"response","model":"gpt-5.6-luna","status":"completed","output":[{"type":"message","id":"msg_1","role":"assistant","status":"completed","content":[{"type":"output_text","text":"hello","annotations":[]}]}],"usage":${JSON.stringify(responsesUsage())}}}`,
      "",
    ].join("\n\n");

    const llm = runtime(() =>
      Promise.resolve(
        new Response(sse, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const result = streamText({
      model: llm.languageModel("gpt-5.6-luna"),
      prompt: "hi",
      ...llm.callOptions({ workload: "contract.stream" }),
    });

    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    expect(text).toBe("hello");
  });

  test("sends tool schemas the provider can validate", async () => {
    let body: unknown;
    const llm = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(textResponse("done"));
    });

    await generateText({
      model: llm.languageModel("gpt-5.6-luna", ["tools"]),
      prompt: "look it up",
      tools: {
        lookup: tool({
          description: "look something up",
          inputSchema: z.object({ id: z.string() }),
          execute: ({ id }) => Promise.resolve({ id }),
        }),
      },
      ...llm.callOptions({ workload: "contract.tools", model: "gpt-5.6-luna" }),
    });

    const parsed = z
      .object({
        tools: z.array(
          z
            .object({
              name: z.string(),
              parameters: z.record(z.string(), z.unknown()),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(body);
    expect(parsed.tools[0]?.name).toBe("lookup");
    expect(parsed.tools[0]?.parameters).toMatchObject({
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  test("asks OpenAI to enforce structured-output schemas strictly", async () => {
    // `strictJsonSchema` is what makes the Responses API reject a response that
    // does not match the schema, rather than handing back prose we would have
    // to parse and repair. Tool-call strictness is a per-tool property and is
    // not governed by this flag.
    let body: unknown;
    const llm = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(
        Response.json({
          id: "resp_obj",
          object: "response",
          model: "gpt-5.6-luna",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_obj",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ answer: "yes" }),
                  annotations: [],
                },
              ],
            },
          ],
          usage: responsesUsage(),
        }),
      );
    });

    await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: z.object({ answer: z.string() }),
      schemaName: "answer",
      prompt: "is it?",
      workload: "contract.object",
    });

    const parsed = z
      .object({
        text: z.object({
          format: z.object({ type: z.string(), strict: z.boolean() }).loose(),
        }),
      })
      .loose()
      .parse(body);
    expect(parsed.text.format).toMatchObject({
      type: "json_schema",
      strict: true,
    });
  });

  test("embeds through the catalog embedding endpoint", async () => {
    let url: string | undefined;
    let body: unknown;
    const llm = runtime((input, init) => {
      url = requestUrl(input);
      body = requestBody(init);
      return Promise.resolve(
        Response.json({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 3, total_tokens: 3 },
        }),
      );
    });

    const result = await embed({
      model: llm.embeddingModel("text-embedding-3-small"),
      value: "hello",
      ...llm.callOptions({ workload: "contract.embed" }),
    });

    expect(result.embedding).toEqual([0.1, 0.2]);
    expect(url).toContain("/embeddings");
    expect(body).toMatchObject({ model: "text-embedding-3-small" });
  });

  test("propagates cancellation to the provider fetch", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const llm = runtime(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => {
            sawAbort = true;
            reject(new DOMException("aborted", "AbortError"));
          };
          if (init?.signal?.aborted === true) {
            abort();
            return;
          }
          init?.signal?.addEventListener("abort", abort);
        }),
    );

    const pending = generateText({
      model: llm.languageModel("gpt-5.6-luna"),
      prompt: "hi",
      abortSignal: controller.signal,
      maxRetries: 0,
      ...llm.callOptions({ workload: "contract.cancel" }),
    });
    // Abort after a turn of the event loop so the provider fetch has started;
    // the harness also handles an already-aborted signal.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(sawAbort).toBe(true);
  });
});

describe("prompt caching", () => {
  test("sends OpenAI's prompt cache key in the request body when one is given", async () => {
    let body: unknown;
    const llm = runtime((_input, init) => {
      body = requestBody(init);
      return Promise.resolve(textResponse("hello"));
    });

    await generateText({
      model: llm.languageModel("gpt-5.6-luna"),
      prompt: "Say hello.",
      ...llm.callOptions({
        workload: "contract.cache",
        sessionId: "turn-1",
        promptCacheKey: "contract.cache:v1",
      }),
    });

    expect(
      z.object({ prompt_cache_key: z.string() }).loose().parse(body)
        .prompt_cache_key,
    ).toBe("contract.cache:v1");
  });

  test("keeps strict schemas alongside the cache key for an OpenAI model", () => {
    const llm = runtime(() => Promise.resolve(textResponse("unused")));
    expect(
      llm.callOptions({
        workload: "contract.cache",
        model: "gpt-5.6-luna",
        promptCacheKey: "contract.cache:v1",
      }).providerOptions,
    ).toEqual({
      openai: { strictJsonSchema: true, promptCacheKey: "contract.cache:v1" },
    });
  });
});

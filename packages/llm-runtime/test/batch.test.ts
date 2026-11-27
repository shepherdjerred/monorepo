import { describe, expect, test } from "vitest";
import {
  type BatchRequest,
  batchCostUsd,
  createAnthropicBatchClient,
  toStructuredOutputSchema,
} from "#src/batch.ts";

type Recorded = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** A batch API that ends after `pollsUntilEnded` status calls and returns `lines` as results. */
function fakeApi(options: {
  pollsUntilEnded?: number;
  lines?: unknown[];
  failWith?: number;
}) {
  const calls: Recorded[] = [];
  let polls = 0;
  const fetcher = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : undefined;
    calls.push({ url, method, headers: new Headers(init?.headers), body });
    if (options.failWith !== undefined) {
      return Promise.resolve(
        new Response("denied", { status: options.failWith }),
      );
    }
    if (method === "POST") {
      return Promise.resolve(
        Response.json({ id: "batch_1", processing_status: "in_progress" }),
      );
    }
    if (url.endsWith("/results")) {
      return Promise.resolve(
        new Response(
          (options.lines ?? []).map((line) => JSON.stringify(line)).join("\n"),
        ),
      );
    }
    polls += 1;
    const ended = polls > (options.pollsUntilEnded ?? 0);
    return Promise.resolve(
      Response.json({
        id: "batch_1",
        processing_status: ended ? "ended" : "in_progress",
      }),
    );
  };
  return { fetcher, calls };
}

const REQUEST: BatchRequest = {
  customId: "unit-1",
  model: "claude-haiku-5-5",
  system: [
    {
      type: "text",
      text: "shared prefix",
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  messages: [{ role: "user", content: "write tips" }],
  maxTokens: 1000,
  tools: [
    {
      name: "lookup",
      description: "read a page",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" } },
      },
    },
  ],
  toolChoice: "auto",
  jsonSchema: { type: "object" },
  effort: "low",
};

function succeeded(customId: string, usage: Record<string, unknown>) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded",
      message: {
        content: [
          { type: "thinking", thinking: "..." },
          { type: "text", text: '{"tips":[' },
          { type: "text", text: "]}" },
          {
            type: "tool_use",
            id: "tu_1",
            name: "lookup",
            input: { title: "Slow" },
          },
        ],
        stop_reason: "tool_use",
        usage,
      },
    },
  };
}

describe("the batch client", () => {
  test("submits requests in the batch API's shape, with cache breakpoints, tools and structured output", async () => {
    const api = fakeApi({ lines: [] });
    const client = createAnthropicBatchClient({
      credentials: { kind: "apiKey", apiKey: "test-key" },
      fetch: api.fetcher,
      sleep: () => Promise.resolve(),
    });
    const id = await client.submit([REQUEST]);

    expect(id).toBe("batch_1");
    const post = api.calls[0];
    expect(post?.url).toBe("https://api.anthropic.com/v1/messages/batches");
    expect(post?.headers.get("x-api-key")).toBe("test-key");
    expect(post?.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(post?.body).toEqual({
      requests: [
        {
          custom_id: "unit-1",
          params: {
            model: "claude-haiku-5-5",
            max_tokens: 1000,
            system: [
              {
                type: "text",
                text: "shared prefix",
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            messages: [{ role: "user", content: "write tips" }],
            tools: [
              {
                name: "lookup",
                description: "read a page",
                input_schema: {
                  type: "object",
                  properties: { title: { type: "string" } },
                },
              },
            ],
            tool_choice: { type: "auto" },
            output_config: {
              format: { type: "json_schema", schema: { type: "object" } },
              effort: "low",
            },
          },
        },
      ],
    });
  });

  test("polls until the batch has ended, then returns typed outcomes priced at the batch tier", async () => {
    const api = fakeApi({
      pollsUntilEnded: 2,
      lines: [
        succeeded("unit-1", {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 2000,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            ephemeral_1h_input_tokens: 2000,
          },
        }),
        {
          custom_id: "unit-2",
          result: { type: "errored", error: { type: "overloaded" } },
        },
        { custom_id: "unit-3", result: { type: "expired" } },
      ],
    });
    const sleeps: number[] = [];
    const polled: string[] = [];
    const client = createAnthropicBatchClient({
      credentials: { kind: "apiKey", apiKey: "test-key" },
      fetch: api.fetcher,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    });
    const outcomes = await client.run(
      [
        REQUEST,
        { ...REQUEST, customId: "unit-2" },
        { ...REQUEST, customId: "unit-3" },
      ],
      {
        pollMs: 7,
        onPoll: (status) => {
          polled.push(status.processing_status);
        },
      },
    );

    expect(polled).toEqual(["in_progress", "in_progress", "ended"]);
    expect(sleeps).toEqual([7, 7]);
    const [first, second, third] = outcomes;
    expect(first).toMatchObject({
      customId: "unit-1",
      status: "succeeded",
      text: '{"tips":[]}',
      stopReason: "tool_use",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 5000,
        cacheWriteTokens: 2000,
        cacheWriteByTtl: { "5m": 0, "1h": 2000 },
      },
    });
    // The thinking block is not an answer; the tool call is kept for the caller to answer.
    expect(first?.status === "succeeded" ? first.content : []).toEqual([
      { type: "text", text: '{"tips":[' },
      { type: "text", text: "]}" },
      {
        type: "tool_use",
        id: "tu_1",
        name: "lookup",
        input: { title: "Slow" },
      },
    ]);
    // A tool loop replays the response as returned, thinking block included.
    expect(
      first?.status === "succeeded" ? first.rawContent[0] : undefined,
    ).toEqual({
      type: "thinking",
      thinking: "...",
    });
    // Haiku 5.5: $0.10 input, $0.50 output, $0.01 cache read, $0.20 1h write per million; batch is half.
    const expected =
      ((1000 * 0.1 + 200 * 0.5 + 5000 * 0.01 + 2000 * 0.2) / 1_000_000) * 0.5;
    expect(first?.status === "succeeded" ? first.costUsd : 0).toBeCloseTo(
      expected,
      10,
    );
    expect(second).toEqual({
      customId: "unit-2",
      status: "errored",
      error: '{"type":"overloaded"}',
    });
    expect(third).toEqual({
      customId: "unit-3",
      status: "expired",
      error: "expired",
    });
  });

  test("the batch price is half the standard price for the same tokens", () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteByTtl: {},
    };
    expect(batchCostUsd("claude-sonnet-5-5", usage)).toBeCloseTo(
      batchCostUsd("claude-sonnet-5-5", usage, "standard") / 2,
      10,
    );
  });

  test("rejects duplicate ids, fails loudly on an HTTP error, and never prices an unknown model at zero", async () => {
    const api = fakeApi({});
    const client = createAnthropicBatchClient({
      credentials: { kind: "apiKey", apiKey: "k" },
      fetch: api.fetcher,
    });
    await expect(client.submit([REQUEST, REQUEST])).rejects.toThrow(
      "unique custom ids",
    );

    const denied = createAnthropicBatchClient({
      credentials: { kind: "apiKey", apiKey: "k" },
      fetch: fakeApi({ failWith: 403 }).fetcher,
    });
    await expect(denied.submit([REQUEST])).rejects.toThrow("HTTP 403");
    expect(() =>
      batchCostUsd("no-such-model", {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWriteByTtl: {},
      }),
    ).toThrow("no batch price on file");
  });
});

describe("toStructuredOutputSchema", () => {
  test("removes the keywords the grammar rejects at every depth", () => {
    expect(
      toStructuredOutputSchema({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: {
          index: {
            type: "integer",
            minimum: Number.MIN_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
          },
          tips: {
            type: "array",
            items: { type: "string", maxLength: 160 },
            minItems: 1,
          },
          cite: { oneOf: [{ type: "object" }, { type: "string" }] },
        },
        required: ["index"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        index: { type: "integer" },
        tips: { type: "array", items: { type: "string" } },
        cite: { anyOf: [{ type: "object" }, { type: "string" }] },
      },
      required: ["index"],
      additionalProperties: false,
    });
  });
});

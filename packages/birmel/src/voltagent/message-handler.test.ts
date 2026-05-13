import { describe, expect, it } from "bun:test";
import { streamWithEmptyRetry } from "./message-stream.ts";

async function* streamChunks(chunks: readonly string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function makeAgent(chunks: readonly string[]) {
  return {
    streamText: async () => ({
      textStream: streamChunks(chunks),
    }),
  };
}

function makePlaceholder() {
  const edits: string[] = [];
  return {
    edits,
    message: {
      edit: async (content: string) => {
        edits.push(content);
      },
    },
  };
}

describe("streamWithEmptyRetry", () => {
  it("uses the router output when the first stream has text", async () => {
    const placeholder = makePlaceholder();
    let directFactoryCalls = 0;

    const result = await streamWithEmptyRetry({
      routerAgent: makeAgent(["hello"]),
      directMessagingAgentFactory: () => {
        directFactoryCalls++;
        return makeAgent(["fallback"]);
      },
      input: "prompt",
      userId: "user-1",
      conversationId: "channel:1",
      placeholderMessage: placeholder.message,
      requestId: "msg-1",
      persona: "hirza",
    });

    expect(result.text).toBe("hello");
    expect(result.attempts.map((attempt) => attempt.name)).toEqual(["router"]);
    expect(directFactoryCalls).toBe(0);
  });

  it("retries with the direct messaging agent when the router stream is empty", async () => {
    const placeholder = makePlaceholder();

    const result = await streamWithEmptyRetry({
      routerAgent: makeAgent([]),
      directMessagingAgentFactory: () => makeAgent(["direct reply"]),
      input: "prompt",
      userId: "user-1",
      conversationId: "channel:1",
      placeholderMessage: placeholder.message,
      requestId: "msg-2",
      persona: "hirza",
    });

    expect(result.text).toBe("direct reply");
    expect(result.attempts.map((attempt) => attempt.name)).toEqual([
      "router",
      "direct-messaging",
    ]);
    expect(result.attempts.map((attempt) => attempt.text.length)).toEqual([
      0,
      "direct reply".length,
    ]);
  });

  it("returns an empty result only after both attempts produce no text", async () => {
    const placeholder = makePlaceholder();

    const result = await streamWithEmptyRetry({
      routerAgent: makeAgent([]),
      directMessagingAgentFactory: () => makeAgent([]),
      input: "prompt",
      userId: "user-1",
      conversationId: "channel:1",
      placeholderMessage: placeholder.message,
      requestId: "msg-3",
      persona: "hirza",
    });

    expect(result.text).toBe("");
    expect(result.attempts.map((attempt) => attempt.name)).toEqual([
      "router",
      "direct-messaging",
    ]);
    expect(result.attempts.map((attempt) => attempt.text.length)).toEqual([
      0, 0,
    ]);
  });
});

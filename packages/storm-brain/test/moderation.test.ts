import { describe, expect, test, vi } from "vitest";
import { createModeration, type ContextCheck } from "#src/moderation.ts";
import { ModerationRequestSchema } from "#src/moderation-schema.ts";

const request = ModerationRequestSchema.parse({
  version: 1,
  submissionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  authorId: "alice",
  authorName: "Alice",
  surface: "chat",
  audience: "global",
  text: "hello everyone",
  context: "",
});
const usage = {
  tokens: {
    input: 0,
    output: 0,
    cachedInput: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
  },
  catalogCostUsd: 0,
};
const clean: ContextCheck = async () => ({
  response: {
    decision: "allow",
    category: "none",
    confidence: 1,
    reason: "Allowed conversation.",
  },
  usage,
});
function provider(scores: Record<string, number> = {}) {
  return Response.json({
    model: "moderation-fixture",
    results: [
      {
        category_scores: {
          hate: 0,
          "hate/threatening": 0,
          harassment: 0,
          "harassment/threatening": 0,
          ...scores,
        },
      },
    ],
  });
}

describe("purpose-built screening", () => {
  test("screens the visible author without truncating the allowed body", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      provider(),
    );
    const moderate = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher,
      contextual: clean,
    });
    const text = "x".repeat(2000);
    await moderate({
      ...request,
      surface: "discord",
      authorName: "Visible name",
      text,
    });
    expect(fetcher.mock.calls[0]?.[1].body).toBe(
      JSON.stringify({
        model: "omni-moderation-latest",
        input: `Visible name: ${text}`,
      }),
    );
  });

  test("promotion in a Discord nickname receives contextual review", async () => {
    const contextual = vi.fn(clean);
    const moderate = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () => provider(),
      contextual,
    });
    const submission = {
      ...request,
      surface: "discord",
      authorName: "Join discord.gg/cold",
      text: "hello",
    };
    await moderate(submission);
    expect(contextual).toHaveBeenCalledExactlyOnceWith(submission);
  });

  test("screens ordinary text without a generation call", async () => {
    const contextual = vi.fn(clean);
    const fetcher = vi.fn(async () => provider());
    const moderate = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher,
      contextual,
    });
    const result = await moderate(request);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(contextual).not.toHaveBeenCalled();
    expect(result.response.decision).toBe("allow");
    expect(result.response.costMicros).toBe(0);
  });

  test.each(["sign", "book", "message", "item-name", "discord"])(
    "screens %s without a caps or link prefilter",
    async (surface) => {
      const contextual = vi.fn<ContextCheck>(async () => ({
        response: {
          decision: "block",
          category: "threat",
          confidence: 0.99,
          reason: "A targeted real-world threat.",
        },
        usage,
      }));
      const moderate = createModeration({
        apiKey: "fixture-key",
        contextModel: "fixture",
        fetcher: async () => provider({ "harassment/threatening": 0.99 }),
        contextual,
      });
      const result = await moderate({
        ...request,
        surface,
        text: "a targeted threat without caps or links",
      });
      expect(result.response.category).toBe("threat");
      expect(contextual).toHaveBeenCalledOnce();
    },
  );

  test("an invitation is contextual, not an automatic advertising strike", async () => {
    const contextual = vi.fn(clean);
    const moderate = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () => provider(),
      contextual,
    });
    const result = await moderate({
      ...request,
      surface: "message",
      text: "Here is the link you asked for: https://example.com",
      context: "Bob: Can you send me your server?",
    });
    expect(result.response.decision).toBe("allow");
    expect(contextual).toHaveBeenCalledOnce();
  });

  test("game threats are reviewed in context rather than blindly applying a provider flag", async () => {
    const moderate = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () => provider({ "harassment/threatening": 0.9 }),
      contextual: clean,
    });
    const result = await moderate({
      ...request,
      text: "I'll kill you next round",
    });
    expect(result.response.decision).toBe("allow");
  });

  test("provider errors and malformed scores never approve publication", async () => {
    const failed = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () => new Response("unavailable", { status: 503 }),
      contextual: clean,
    });
    await expect(failed(request)).rejects.toMatchObject({
      name: "BrainUpstreamError",
      message: "Moderation returned HTTP 503",
    });
    const malformed = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () =>
        Response.json({ model: "invalid", results: [{ category_scores: {} }] }),
      contextual: clean,
    });
    await expect(malformed(request)).rejects.toThrow("category missing");
  });

  test("schema rejects oversized or unexpected content instead of truncating it", () => {
    expect(
      ModerationRequestSchema.safeParse({ ...request, text: "a".repeat(4001) })
        .success,
    ).toBe(false);
    expect(
      ModerationRequestSchema.safeParse({ ...request, ignored: "anything" })
        .success,
    ).toBe(false);
    expect(
      ModerationRequestSchema.safeParse({ ...request, text: "😀".repeat(4000) })
        .success,
    ).toBe(true);
    expect(
      ModerationRequestSchema.safeParse({ ...request, text: "😀".repeat(4001) })
        .success,
    ).toBe(false);
  });

  test("provider and contextual failures never copy private text into diagnostics", async () => {
    const privateText = "private body that must stay out of logs";
    const malformed = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () =>
        Response.json({
          model: privateText,
          results: [{ category_scores: { hate: privateText } }],
        }),
      contextual: clean,
    });
    await expect(malformed(request)).rejects.toThrow(
      "Moderation returned invalid scores",
    );
    const contextual = createModeration({
      apiKey: "fixture-key",
      contextModel: "fixture",
      fetcher: async () => provider({ hate: 0.9 }),
      contextual: async () => {
        throw new Error(privateText);
      },
    });
    await expect(contextual(request)).rejects.toThrow(
      "Contextual content review failed",
    );
  });
});

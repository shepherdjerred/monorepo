import {
  createLlmRuntime,
  type LlmRuntimeOptions,
} from "@shepherdjerred/llm-runtime";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  createModeration,
  PROMOTION,
  type ContextCheck,
} from "#src/moderation.ts";
import {
  ModerationRequestSchema,
  ModerationResponseSchema,
} from "#src/moderation-schema.ts";

type RuntimeFetch = NonNullable<LlmRuntimeOptions["fetch"]>;

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

const CapturedDecisionBodySchema = z.object({
  model: z.string(),
  prompt_cache_key: z.string().optional(),
  system: z.array(
    z.object({
      type: z.literal("input_text"),
      text: z.string(),
      prompt_cache_breakpoint: z.boolean().optional(),
    }),
  ),
  questions: z.array(
    z.object({
      type: z.literal("choice"),
      name: z.string(),
      choices: z.array(
        z.object({
          value: z.string(),
          description: z.string().optional(),
        }),
      ),
    }),
  ),
});

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

describe("promotion prefilter and parallel execution", () => {
  test.each([
    "want to play?",
    "anyone want to play rwf?",
    "visit my town on the server",
    "come visit my town on the server",
    "sell iron",
    "buy diamonds",
    "where can I buy oak logs or sell iron?",
    "invite me to team",
    "invite me to your party",
    "lagging on the server",
  ])(
    "ordinary Minecraft chat %j does not match PROMOTION or invoke contextual moderation",
    async (text) => {
      expect(PROMOTION.test(`Alice: ${text}`)).toBe(false);
      const contextual = vi.fn(clean);
      const fetcher = vi.fn(async () => provider());
      const moderate = createModeration({
        apiKey: "fixture-key",
        contextModel: "fixture",
        fetcher,
        contextual,
      });
      const result = await moderate({ ...request, text });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(contextual).not.toHaveBeenCalled();
      expect(result.response.decision).toBe("allow");
      expect(result.response.costMicros).toBe(0);
    },
  );

  test.each([
    "Join discord.gg/cold",
    "connect to play.othercraft.net",
    "join my server",
    "dm me to buy for $10 paypal",
    "connect to mc.othercraft.club",
    "198.51.100.42:25565",
  ])(
    "external promotion %j triggers contextual moderation in parallel with /v1/moderations",
    async (text) => {
      let releaseModeration!: () => void;
      const moderationGate = new Promise<void>((resolve) => {
        releaseModeration = resolve;
      });
      let moderationStarted = false;
      let contextualStartedWhileModerationPending = false;

      const fetcher = vi.fn(async () => {
        moderationStarted = true;
        await moderationGate;
        return provider();
      });
      const contextual = vi.fn<ContextCheck>(async () => {
        contextualStartedWhileModerationPending = moderationStarted;
        releaseModeration();
        return {
          response: {
            decision: "block",
            category: "advertising",
            confidence: 0.96,
            reason:
              "Unsolicited external server, Discord, or real-money promotion is not permitted.",
          },
          usage,
        };
      });

      const moderate = createModeration({
        apiKey: "fixture-key",
        contextModel: "gpt-6-luna",
        fetcher,
        contextual,
      });
      const result = await moderate({ ...request, text });
      expect(contextualStartedWhileModerationPending).toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(contextual).toHaveBeenCalledOnce();
      expect(result.response.decision).toBe("block");
      expect(result.response.category).toBe("advertising");
    },
  );
});

describe("OpenAI Decisions API contextual moderation", () => {
  test("sends 2 batched choice questions, normalizes answers, and prices $0 output tokens", async () => {
    const capturedCalls: { url: string; body: unknown }[] = [];
    const fakeRuntimeFetch: RuntimeFetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      capturedCalls.push({
        url,
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
      });
      return Response.json({
        id: "dec_mod_1",
        model: "gpt-6-luna",
        answers: [
          {
            type: "choice",
            name: "decision",
            choice: "block",
            confidence: 0.94,
            probabilities: [
              { value: "block", probability: 0.94 },
              { value: "review", probability: 0.04 },
              { value: "allow", probability: 0.02 },
            ],
          },
          {
            type: "choice",
            name: "category",
            choice: "none",
            confidence: 0.52,
            probabilities: [
              { value: "none", probability: 0.52 },
              { value: "advertising", probability: 0.41 },
              { value: "spam", probability: 0.07 },
            ],
          },
        ],
        usage: {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 800 },
          output_tokens: 0,
          total_tokens: 1000,
        },
      });
    };

    const runtime = createLlmRuntime({
      credentials: { openai: { apiKey: "fixture-key" } },
      service: "storm-brain",
      appName: "storm-brain",
      fetch: fakeRuntimeFetch,
    });

    const moderate = createModeration({
      apiKey: "fixture-key",
      decisionsModel: "gpt-6-luna",
      runtime,
      fetcher: async () => provider(),
    });

    const decided = await moderate({
      ...request,
      text: "join my server right now",
    });

    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]?.url).toBe("https://api.openai.com/v1/decisions");
    const wire = CapturedDecisionBodySchema.parse(capturedCalls[0]?.body);
    expect(wire.model).toBe("gpt-6-luna");
    expect(wire.prompt_cache_key).toBe("storm-brain:moderate:v1");
    expect(wire.system[0]?.prompt_cache_breakpoint).toBe(true);
    expect(wire.questions.map((question) => question.name)).toEqual([
      "decision",
      "category",
    ]);

    const parsedResponse = ModerationResponseSchema.parse(decided.response);
    expect(parsedResponse).toMatchObject({
      version: 1,
      decision: "block",
      category: "advertising",
      confidence: 0.94,
      reason:
        "Unsolicited external server, Discord, or real-money promotion is not permitted.",
      model: "moderation-fixture+gpt-6-luna",
      costMicros: 28,
    });
    expect(decided.usage.tokens.output).toBe(0);
    expect(decided.usage.tokens.input).toBe(200);
    expect(decided.usage.tokens.cachedInput).toBe(800);
    expect(decided.usage.catalogCostUsd).toBeCloseTo(0.000028, 9);
  });

  test("normalizes allow+non-none to none and handles refusal safely as review", async () => {
    let returnRefusal = false;
    const runtime = createLlmRuntime({
      credentials: { openai: { apiKey: "fixture-key" } },
      service: "storm-brain",
      appName: "storm-brain",
      fetch: async () =>
        Response.json({
          id: "dec_mod_2",
          model: "gpt-6-luna",
          answers: returnRefusal
            ? [
                { type: "refusal", name: "decision" },
                {
                  type: "choice",
                  name: "category",
                  choice: "hate",
                  confidence: 0.9,
                  probabilities: [{ value: "hate", probability: 0.9 }],
                },
              ]
            : [
                {
                  type: "choice",
                  name: "decision",
                  choice: "allow",
                  confidence: 0.91,
                  probabilities: [{ value: "allow", probability: 0.91 }],
                },
                {
                  type: "choice",
                  name: "category",
                  choice: "threat",
                  confidence: 0.6,
                  probabilities: [{ value: "threat", probability: 0.6 }],
                },
              ],
          usage: {
            input_tokens: 20_000,
            output_tokens: 0,
            total_tokens: 20_000,
          },
        }),
    });

    const moderate = createModeration({
      apiKey: "fixture-key",
      decisionsModel: "gpt-6-luna",
      runtime,
      fetcher: async () => provider({ "harassment/threatening": 0.85 }),
    });

    const allowed = await moderate({
      ...request,
      text: "I'll kill you next round",
    });
    expect(ModerationResponseSchema.parse(allowed.response)).toMatchObject({
      decision: "allow",
      category: "none",
      confidence: 0.91,
      reason: "Allowed in conversation context.",
      costMicros: 2000,
    });

    returnRefusal = true;
    const refused = await moderate({
      ...request,
      text: "ambiguous flagged content",
    });
    expect(ModerationResponseSchema.parse(refused.response)).toMatchObject({
      decision: "review",
      category: "threat",
      confidence: 1,
      reason: "Content requires staff review.",
      costMicros: 2000,
    });
  });
});

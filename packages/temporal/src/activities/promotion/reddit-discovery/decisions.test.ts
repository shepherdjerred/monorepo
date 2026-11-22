import { describe, expect, it } from "vitest";
import { costForDecisionUsage } from "@shepherdjerred/llm-models";
import {
  DecisionWireResponseSchema,
  StructuredOutputUsageError,
} from "@shepherdjerred/llm-runtime";
import {
  DECISIONS_MODEL,
  REDDIT_DECISION_QUESTIONS,
  DecisionHttpError,
  DecisionRateLimit,
  buildRedditDecisionRequest,
  judgeRedditRequest,
  qualifyRedditDecision,
  type RedditJudgeInput,
} from "./decisions.ts";

function input(): RedditJudgeInput {
  return {
    post: {
      id: "abc123",
      subreddit: "MinecraftServer",
      url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
      author: "player-private-name",
      title: "looking for a chill SMP",
      body: "Java survival with optional quests is fine",
      createdAt: "2026-11-19T18:00:00Z",
    },
    serverFacts:
      "The Storm offers Java/Bedrock survival and optional quests; supports licensed accounts; server is already running.",
    communityRules:
      "Server owners may reply to explicit server requests. Automated comments are permitted.",
    signal: new AbortController().signal,
  };
}

function predicate(name: string, probability = 0.99) {
  return { type: "predicate" as const, name, probability };
}
function choice(
  name: string,
  values: string[],
  selected: string,
  confidence = 0.99,
) {
  return {
    type: "choice" as const,
    name,
    choice: selected,
    confidence,
    probabilities: values.map((value) => ({
      value,
      probability:
        value === selected
          ? confidence
          : (1 - confidence) / (values.length - 1),
    })),
  };
}

function ruleChoice(
  selected: "restricted" | "no_identified_restriction",
  confidence = 0.99,
) {
  return choice(
    "community_reply_restriction",
    ["restricted", "no_identified_restriction"],
    selected,
    confidence,
  );
}

function response() {
  return {
    model: DECISIONS_MODEL,
    answers: [
      predicate("explicit_server_seeker"),
      predicate("strong_main_match"),
      ruleChoice("no_identified_restriction"),
      choice(
        "post_intent",
        [
          "find_server",
          "advertise_server",
          "hosting_or_support",
          "other_or_unclear",
        ],
        "find_server",
      ),
      choice(
        "hard_constraints",
        ["satisfied", "unmet", "unknown"],
        "satisfied",
      ),
    ],
    usage: {
      input_tokens: 70,
      output_tokens: 0,
      total_tokens: 70,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function parseRedditDecisionResponse(raw: unknown) {
  const { answers, model, usage } = DecisionWireResponseSchema.parse(raw);
  return qualifyRedditDecision({
    answers,
    model,
    usage: {
      inputTokens: usage.input_tokens,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens,
    },
  });
}

describe("Reddit Decisions qualification", () => {
  it("builds one classification request with independent main-fit, intent, hard-constraint and community restriction questions", () => {
    const request = buildRedditDecisionRequest(input());
    expect(request.model).toBe("gpt-6-luna");
    expect(request.questions.map((question) => question.name)).toEqual([
      "explicit_server_seeker",
      "strong_main_match",
      "community_reply_restriction",
      "post_intent",
      "hard_constraints",
    ]);
    const text = JSON.stringify(request);
    expect(text).toContain("MAIN request");
    expect(text).toContain("Unknown facts cannot support a match");
    expect(text).toContain("untrustedPost");
    expect(text).not.toContain("player-private-name");
    expect(text).not.toContain("createdAt");
    expect(text).not.toContain("apiKey");
    expect(
      new Set(request.questions.map((question) => question.name)).size,
    ).toBe(REDDIT_DECISION_QUESTIONS.length);
  });

  it("accepts a complete strong match and exposes cache-aware billable input usage", () => {
    const result = parseRedditDecisionResponse(response());
    expect(result.qualification).toMatchObject({
      decision: "match",
      judgeScore: 0.99,
      explicitlySeekingServer: true,
      communityAllowsReply: true,
      hardConstraintsSatisfied: true,
    });
    expect(result.usage.tokens).toEqual({
      input: 40,
      output: 0,
      cachedInput: 20,
      cacheWrite: 10,
      reasoning: 0,
      total: 70,
    });
    expect(result.usage.catalogCostUsd).toBe(
      costForDecisionUsage(DECISIONS_MODEL, {
        inputTokens: 70,
        cachedInputTokens: 20,
        cacheWriteTokens: 10,
      }),
    );
  });

  it.each([0, 0.79, 0.8])(
    "requires main fit strictly above .80: %s",
    (score) => {
      const raw = response();
      raw.answers[1] = predicate("strong_main_match", score);
      expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
        "no-match",
      );
    },
  );

  it("accepts a main-fit probability just above .80", () => {
    const raw = response();
    raw.answers[1] = predicate("strong_main_match", 0.800001);
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "match",
    );
  });

  it("uses the chosen answer's probability when separate confidence differs", () => {
    const raw = response();
    raw.answers[4] = {
      ...choice(
        "hard_constraints",
        ["satisfied", "unmet", "unknown"],
        "satisfied",
        0.82,
      ),
      confidence: 0.73,
    };
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "match",
    );
  });

  it("still requires explicit server-seeker intent", () => {
    const raw = response();
    raw.answers[0] = predicate("explicit_server_seeker", 0.8);
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "no-match",
    );
  });

  it("accepts an eligible request when no concrete rule restricts the reply", () => {
    const raw = response();
    raw.answers[2] = ruleChoice("no_identified_restriction", 0.51);
    expect(parseRedditDecisionResponse(raw).qualification).toMatchObject({
      decision: "match",
      communityAllowsReply: true,
    });
  });

  it("blocks an applicable restriction even for a high-fit request", () => {
    const raw = response();
    raw.answers[2] = ruleChoice("restricted", 0.51);
    expect(parseRedditDecisionResponse(raw).qualification).toMatchObject({
      decision: "no-match",
      communityAllowsReply: false,
      reason: expect.stringContaining("community rules restrict this reply"),
    });
  });

  it("rejects a rules answer that contradicts its own distribution", () => {
    const raw = response();
    raw.answers[2] = ruleChoice("no_identified_restriction", 0.49);
    expect(parseRedditDecisionResponse(raw).qualification).toMatchObject({
      decision: "no-match",
      communityAllowsReply: false,
      reason: expect.stringContaining("invalid community rules assessment"),
    });
  });

  it.each(["unmet", "unknown"])(
    "disqualifies %s hard constraints even with perfect main fit",
    (selected) => {
      const raw = response();
      raw.answers[4] = choice(
        "hard_constraints",
        ["satisfied", "unmet", "unknown"],
        selected,
        1,
      );
      expect(parseRedditDecisionResponse(raw).qualification).toMatchObject({
        decision: "no-match",
        hardConstraintsSatisfied: false,
      });
    },
  );

  it.each(["advertise_server", "hosting_or_support", "other_or_unclear"])(
    "rejects non-seeker intent: %s",
    (selected) => {
      const raw = response();
      raw.answers[3] = choice(
        "post_intent",
        [
          "find_server",
          "advertise_server",
          "hosting_or_support",
          "other_or_unclear",
        ],
        selected,
      );
      expect(parseRedditDecisionResponse(raw).qualification).toMatchObject({
        decision: "no-match",
        explicitlySeekingServer: false,
      });
    },
  );
});

describe("Reddit Decisions response validation", () => {
  it("rejects missing and duplicate named answers instead of trusting the remaining high score", () => {
    const missing = response();
    missing.answers.pop();
    expect(parseRedditDecisionResponse(missing).qualification.decision).toBe(
      "no-match",
    );
    const duplicate = response();
    duplicate.answers[4] = predicate("strong_main_match", 1);
    expect(parseRedditDecisionResponse(duplicate).qualification.decision).toBe(
      "no-match",
    );
  });

  it("rejects refusal and wrong-type answers without losing consumed usage", () => {
    const raw = response();
    const refused = {
      ...raw,
      answers: [
        ...raw.answers.slice(0, 4),
        { type: "refusal", name: "hard_constraints" },
      ],
    };
    expect(parseRedditDecisionResponse(refused)).toMatchObject({
      qualification: { decision: "no-match" },
      usage: { tokens: { total: 70 } },
    });
    raw.answers[0] = choice("explicit_server_seeker", ["yes", "no"], "yes");
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "no-match",
    );
  });

  it("rejects invented, duplicate or unnormalized choice distributions", () => {
    const raw = response();
    raw.answers[4] = choice(
      "hard_constraints",
      ["satisfied", "invented"],
      "satisfied",
    );
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "no-match",
    );
    raw.answers[4] = choice(
      "hard_constraints",
      ["satisfied", "unmet", "unknown"],
      "satisfied",
    );
    const answer = raw.answers[4];
    if (answer?.type !== "choice") throw new Error("Fixture choice missing");
    answer.probabilities.push({ value: "satisfied", probability: 0.99 });
    expect(parseRedditDecisionResponse(raw).qualification.decision).toBe(
      "no-match",
    );
  });

  it("keeps reported output dimensions while charging only input for Decisions", () => {
    const raw = response();
    raw.usage.output_tokens = 10;
    raw.usage.total_tokens = 80;
    const result = parseRedditDecisionResponse(raw);
    expect(result.usage.tokens.output).toBe(10);
    expect(result.usage.catalogCostUsd).toBe(
      parseRedditDecisionResponse(response()).usage.catalogCostUsd,
    );
  });
});

describe("Decisions HTTP adapter", () => {
  it("calls only the documented endpoint once with configured credentials and a bounded signal", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await judgeRedditRequest(input(), {
      credentials: { openai: { apiKey: "fixture-key" } },
      fetcher: (url, init) => {
        const address = url instanceof Request ? url.url : url.toString();
        calls.push({ url: address, init: init ?? {} });
        return Promise.resolve(Response.json(response()));
      },
    });
    expect(result.qualification.decision).toBe("match");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/decisions");
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      "Bearer fixture-key",
    );
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    const body = calls[0]?.init.body;
    if (typeof body !== "string")
      throw new TypeError("Expected a JSON request body");
    expect(JSON.parse(body)).toMatchObject({ model: "gpt-6-luna" });
  });

  it.each([401, 403, 429, 503])(
    "exposes HTTP %s without response bodies or retrying",
    async (status) => {
      let calls = 0;
      const action = judgeRedditRequest(input(), {
        credentials: { openai: { apiKey: "fixture-key" } },
        fetcher: () => {
          calls++;
          return Promise.resolve(
            new Response("private provider diagnostic fixture-key", {
              status,
              headers: { "retry-after": "120" },
            }),
          );
        },
      });
      await expect(action).rejects.toBeInstanceOf(
        status === 429 ? DecisionRateLimit : DecisionHttpError,
      );
      await expect(action).rejects.toMatchObject({
        status,
        retryAt: expect.any(String),
      });
      await expect(action).rejects.not.toThrow("fixture-key");
      expect(calls).toBe(1);
    },
  );

  it.each([
    { answers: null },
    { answers: [predicate("strong_main_match", 2)] },
  ])(
    "keeps billed usage when the shared client rejects $answers",
    async ({ answers }) => {
      const action = judgeRedditRequest(input(), {
        credentials: { openai: { apiKey: "fixture-key" } },
        fetcher: () =>
          Promise.resolve(Response.json({ ...response(), answers })),
      });
      await expect(action).rejects.toBeInstanceOf(StructuredOutputUsageError);
      await expect(action).rejects.toMatchObject({
        usage: { tokens: { total: 70 } },
      });
    },
  );

  it("accepts an HTTP-date Retry-After and retains no invented deadline when absent", async () => {
    const options = {
      credentials: { openai: { apiKey: "fixture" } },
      fetcher: () =>
        Promise.resolve(
          new Response("", {
            status: 429,
            headers: { "retry-after": "Wed, 25 Nov 2026 18:00:00 GMT" },
          }),
        ),
    };
    await expect(judgeRedditRequest(input(), options)).rejects.toMatchObject({
      retryAt: "2026-11-25T18:00:00.000Z",
    });
    await expect(
      judgeRedditRequest(input(), {
        ...options,
        fetcher: () => Promise.resolve(new Response("", { status: 429 })),
      }),
    ).rejects.toMatchObject({ retryAt: null });
  });

  it("sanitizes thrown transport messages and fails missing credentials before requesting", async () => {
    await expect(
      judgeRedditRequest(input(), {
        credentials: { openai: { apiKey: "fixture" } },
        fetcher: () => Promise.reject(new Error("private-token")),
      }),
    ).rejects.toThrow("Reddit Decisions transport failed");
    let calls = 0;
    await expect(
      judgeRedditRequest(input(), {
        credentials: {},
        fetcher: () => {
          calls++;
          return Promise.resolve(Response.json(response()));
        },
      }),
    ).rejects.toThrow("no OpenAI credentials");
    expect(calls).toBe(0);
  });
});

import { APICallError } from "ai";
import {
  StructuredOutputExhaustionError,
  type LlmCallMetadata,
} from "@shepherdjerred/llm-runtime";
import { describe, expect, test } from "vitest";
import {
  acceptLivenessVerdict,
  livenessResearchPrompt,
  normalizeSourceUrl,
  verifyQueueLiveness,
  type QueueLivenessInput,
  type QueueLivenessLlm,
  type QueueLivenessVerdict,
} from "./scout-queue-window-liveness.ts";

const PATCH_URL =
  "https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-20-notes/";
const WIKI_URL = "https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem";
const BLOG_URL = "https://example-esports-blog.com/aram-mayhem-still-live";

const INPUT: QueueLivenessInput = {
  findingId: 'queue-warning:["sparse-no-close","aram mayhem",null]',
  queue: "aram mayhem",
  window: {
    start: "2025-10-22",
    note: "extended indefinitely after positive reception",
  },
  patchNotes: { titles: [{ title: "Patch 26.20 Notes", url: PATCH_URL }] },
  lookbackDays: 28,
  today: "2026-10-18",
};

const RESEARCH_METADATA: LlmCallMetadata = {
  requestedModel: "gpt-5.6-sol",
  provider: "openai",
  serverToolRequests: { webSearch: 2 },
  tokens: {
    input: 1000,
    output: 400,
    cachedInput: 100,
    cacheWrite: 0,
    reasoning: 200,
    total: 1500,
  },
  catalogCostUsd: 0.02,
};

const FINALIZE_USAGE = {
  tokens: {
    input: 500,
    output: 100,
    cachedInput: 0,
    cacheWrite: 0,
    reasoning: 50,
    total: 600,
  },
  catalogCostUsd: 0.004,
};

function fakeLlm(
  verdict: QueueLivenessVerdict,
  researchSources: string[] = [`${WIKI_URL}?utm_source=openai`, PATCH_URL],
): QueueLivenessLlm & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    research: (input) => {
      prompts.push(input.prompt);
      return Promise.resolve({
        text: "ARAM: Mayhem remains in the queue rotation as of patch 26.20.",
        sources: researchSources,
        metadata: RESEARCH_METADATA,
      });
    },
    finalize: (input) => {
      prompts.push(input.prompt);
      return Promise.resolve({ verdict, usage: FINALIZE_USAGE });
    },
  };
}

describe("queue liveness guard", () => {
  test("accepts live only with an allowlisted source the search returned", async () => {
    const llm = fakeLlm({
      status: "live",
      endedOn: null,
      rationale: "The wiki lists the mode as currently available.",
      sources: [WIKI_URL],
    });
    const check = await verifyQueueLiveness(INPUT, llm);

    expect(check).toMatchObject({
      findingId: INPUT.findingId,
      queue: "aram mayhem",
      status: "live",
      sources: [WIKI_URL],
      usage: {
        inputTokens: 1500,
        outputTokens: 500,
        cachedInputTokens: 100,
        webSearchRequests: 2,
      },
    });
    expect(check.usage?.costUsd).toBeCloseTo(0.024);
    // gpt-5.6-sol: 1000 input, 100 cached, 400 output tokens, plus finalize.
    expect(check.usage?.tokenCostUsd).toBeCloseTo(0.01204 + 0.004, 6);
    expect(check.unsupportedLive).toBeUndefined();
    expect(check.errorClass).toBeUndefined();
    // The finalizer sees the research evidence and the source list it may cite.
    expect(llm.prompts[1]).toContain("Research source list:");
    expect(llm.prompts[1]).toContain(PATCH_URL);
  });

  test("keeps an ended verdict and its stated date", async () => {
    const check = await verifyQueueLiveness(
      INPUT,
      fakeLlm({
        status: "ended",
        endedOn: "2026-09-24",
        rationale: "Patch 26.19 removed the mode.",
        sources: [PATCH_URL],
      }),
    );
    expect(check).toMatchObject({
      status: "ended",
      endedOn: "2026-09-24",
      sources: [PATCH_URL],
    });
  });

  test("keeps an unknown verdict", async () => {
    const check = await verifyQueueLiveness(
      INPUT,
      fakeLlm({
        status: "unknown",
        endedOn: null,
        rationale: "No current source mentions the mode.",
        sources: [],
      }),
    );
    expect(check).toMatchObject({ status: "unknown", sources: [] });
    expect(check.endedOn).toBeUndefined();
    expect(check.errorClass).toBeUndefined();
  });

  test("leaves total cost unpriced when a search fee has no catalog price", async () => {
    const llm = fakeLlm({
      status: "live",
      endedOn: null,
      rationale: "Listed as available.",
      sources: [WIKI_URL],
    });
    const research = llm.research;
    llm.research = async (input) => {
      const result = await research(input);
      const { catalogCostUsd: _unpriced, ...metadata } = result.metadata;
      return { ...result, metadata };
    };
    const check = await verifyQueueLiveness(INPUT, llm);
    expect(check.usage?.costUsd).toBeUndefined();
    expect(check.usage?.tokenCostUsd).toBeCloseTo(0.01604, 6);
  });

  test("rejects live backed by a source the search never returned", async () => {
    const hallucinated =
      "https://www.leagueoflegends.com/en-us/news/game-updates/aram-mayhem-forever/";
    const check = await verifyQueueLiveness(
      INPUT,
      fakeLlm({
        status: "live",
        endedOn: null,
        rationale: "Riot announced the mode is permanent.",
        sources: [hallucinated],
      }),
    );
    expect(check).toMatchObject({
      status: "unknown",
      unsupportedLive: true,
      sources: [hallucinated],
    });
    expect(check.rationale).toContain("Model reported live");
  });

  test("rejects live backed only by a non-allowlisted searched source", () => {
    expect(
      acceptLivenessVerdict(
        {
          status: "live",
          endedOn: null,
          rationale: "A blog says it is live.",
          sources: [BLOG_URL],
        },
        [BLOG_URL],
      ),
    ).toEqual({
      status: "unknown",
      sources: [BLOG_URL],
      unsupportedLive: true,
    });
  });

  test("drops unparseable cited URLs", () => {
    expect(
      acceptLivenessVerdict(
        {
          status: "ended",
          endedOn: null,
          rationale: "Removed.",
          sources: ["not a url", "javascript:alert(1)", PATCH_URL],
        },
        [],
      ).sources,
    ).toEqual([PATCH_URL]);
  });

  test("normalizes tracking parameters, fragments and trailing slashes", () => {
    expect(normalizeSourceUrl(`${PATCH_URL}?utm_source=openai#modes`)).toBe(
      normalizeSourceUrl(PATCH_URL.replace(/\/$/u, "")),
    );
    expect(normalizeSourceUrl(`${WIKI_URL}?oldid=1`)).not.toBe(
      normalizeSourceUrl(WIKI_URL),
    );
  });
});

describe("queue liveness boundary failures", () => {
  test("records a transport failure as unknown without failing", async () => {
    const llm: QueueLivenessLlm = {
      research: () =>
        Promise.reject(
          new APICallError({
            message: "upstream unavailable",
            url: "https://api.openai.com/v1/responses",
            requestBodyValues: {},
            statusCode: 503,
          }),
        ),
      finalize: () => Promise.reject(new Error("unreachable")),
    };
    const check = await verifyQueueLiveness(INPUT, llm);
    expect(check).toMatchObject({
      status: "unknown",
      errorClass: "AI_APICallError",
      sources: [],
      usage: { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 },
    });
    expect(check.rationale).toContain("upstream unavailable");
  });

  test("charges research and exhausted finalization usage", async () => {
    const llm = fakeLlm({
      status: "live",
      endedOn: null,
      rationale: "unused",
      sources: [],
    });
    llm.finalize = () =>
      Promise.reject(
        new StructuredOutputExhaustionError(
          "structured output exhausted",
          [],
          FINALIZE_USAGE,
        ),
      );
    const check = await verifyQueueLiveness(INPUT, llm);
    expect(check).toMatchObject({
      status: "unknown",
      errorClass: "StructuredOutputExhaustionError",
      usage: { inputTokens: 1500, outputTokens: 500, webSearchRequests: 2 },
    });
  });

  test("lets a broken internal contract fail loudly", async () => {
    const llm: QueueLivenessLlm = {
      research: () => Promise.reject(new Error("OPENAI_API_KEY is required")),
      finalize: () => Promise.reject(new Error("unreachable")),
    };
    await expect(verifyQueueLiveness(INPUT, llm)).rejects.toThrow(
      "OPENAI_API_KEY is required",
    );
  });
});

describe("queue liveness research prompt", () => {
  test("includes the queue window, observation gap and patch notes", () => {
    const prompt = livenessResearchPrompt(INPUT);
    expect(prompt).toContain('Queue: "aram mayhem"');
    expect(prompt).toContain("started 2025-10-22");
    expect(prompt).toContain("extended indefinitely");
    expect(prompt).toContain("last 28 days");
    expect(prompt).toContain(`Patch 26.20 Notes: ${PATCH_URL}`);
    expect(
      livenessResearchPrompt({
        ...INPUT,
        patchNotes: { error: "fetch failed" },
      }),
    ).toContain("Patch-note listing unavailable: fetch failed");
  });
});

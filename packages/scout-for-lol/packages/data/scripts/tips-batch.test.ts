import { describe, expect, test } from "vitest";
import { z } from "zod";
import type {
  BatchClient,
  BatchOutcome,
  BatchRequest,
  BatchUsage,
} from "@shepherdjerred/llm-runtime/batch";
import { GenerationBudget, TipBudgetExceededError } from "#src/tips/model.ts";
import {
  type BatchJob,
  SearchLimit,
  listPriceUsd,
  runBatchJobs,
} from "./tips-batch.ts";

const Answer = z.object({ answer: z.string() });

const USAGE: BatchUsage = {
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 4000,
  cacheWriteTokens: 0,
  cacheWriteByTtl: {},
};

function job(id: string, withLookup = true): BatchJob<{ answer: string }> {
  return {
    id,
    model: "claude-haiku-5-5",
    system: "system",
    prefix: `prefix for ${id}`,
    rest: "rest",
    schema: Answer,
    effort: "low",
    maxTokens: 500,
    lookup: withLookup
      ? (title) =>
          Promise.resolve({
            text: `page ${title}`,
            pages: { [title]: 7 },
          })
      : undefined,
  };
}

function succeeded(
  customId: string,
  text: string,
  stopReason: "end_turn" | "tool_use" | "max_tokens",
  toolUse?: { id: string; title: string },
): BatchOutcome {
  const raw = [
    { type: "thinking", thinking: "hm", signature: "sig" },
    ...(toolUse === undefined
      ? [{ type: "text", text }]
      : [
          {
            type: "tool_use",
            id: toolUse.id,
            name: "lookup",
            input: { title: toolUse.title },
          },
        ]),
  ];
  return {
    customId,
    status: "succeeded",
    content: [],
    rawContent: raw,
    text,
    stopReason,
    usage: USAGE,
    costUsd: 0.01,
  };
}

/** A batch client answered by a function, recording every round's requests. */
function fakeClient(
  answer: (requests: readonly BatchRequest[], round: number) => BatchOutcome[],
): BatchClient & { rounds: BatchRequest[][] } {
  const rounds: BatchRequest[][] = [];
  return {
    rounds,
    submit: () => Promise.reject(new Error("unused")),
    status: () => Promise.reject(new Error("unused")),
    wait: () => Promise.reject(new Error("unused")),
    results: () => Promise.reject(new Error("unused")),
    run: (requests) => {
      rounds.push([...requests]);
      return Promise.resolve(answer(requests, rounds.length));
    },
  };
}

describe("runBatchJobs", () => {
  test("answers a lookup locally and resubmits only the unfinished jobs, replaying the response as returned", async () => {
    const client = fakeClient((requests, round) =>
      requests.map((request) =>
        round === 1 && request.customId === "a"
          ? succeeded("a", "", "tool_use", { id: "tu1", title: "Slow" })
          : succeeded(request.customId, '{"answer":"done"}', "end_turn"),
      ),
    );
    const budget = new GenerationBudget(5);
    const results = await runBatchJobs(client, [job("a"), job("b")], {
      budget,
      cache: { type: "ephemeral", ttl: "1h" },
    });

    expect(client.rounds.map((round) => round.map((r) => r.customId))).toEqual([
      ["a", "b"],
      ["a"],
    ]);
    const [first, second] = client.rounds;
    // The shared prefix carries the cache breakpoint; the unit's own part does not.
    expect(first?.[0]?.messages[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "prefix for a\n\n",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        { type: "text", text: "rest" },
      ],
    });
    // The second round replays the assistant turn untouched (thinking block and all)
    // and the tool result.
    expect(second?.[0]?.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hm", signature: "sig" },
          {
            type: "tool_use",
            id: "tu1",
            name: "lookup",
            input: { title: "Slow" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu1", content: "page Slow" },
        ],
      },
    ]);
    const [a, b] = results;
    expect(a).toMatchObject({
      id: "a",
      outcome: { status: "ok", object: { answer: "done" } },
      toolCalls: 1,
      lookedUp: { Slow: 7 },
      rounds: 2,
    });
    expect(a?.costUsd).toBeCloseTo(0.02);
    expect(b).toMatchObject({ toolCalls: 0, rounds: 1 });
    expect(budget.summary().spentUsd).toBeCloseTo(0.03);
    expect(a?.listUsd).toBeCloseTo(
      listPriceUsd("claude-haiku-5-5", a?.tokens ?? USAGE),
    );
  });

  test("the last round forbids tools so every job ends with an answer", async () => {
    const client = fakeClient((requests, round) =>
      requests.map((request) =>
        request.toolChoice === "none"
          ? succeeded(request.customId, '{"answer":"final"}', "end_turn")
          : succeeded(request.customId, "", "tool_use", {
              id: `tu${round.toString()}`,
              title: "Slow",
            }),
      ),
    );
    const [result] = await runBatchJobs(client, [job("a")], {
      budget: new GenerationBudget(5),
      maxRounds: 3,
    });
    expect(client.rounds.map((round) => round[0]?.toolChoice)).toEqual([
      undefined,
      undefined,
      "none",
    ]);
    expect(result).toMatchObject({
      outcome: { status: "ok", object: { answer: "final" } },
      toolCalls: 2,
      rounds: 3,
    });
  });

  test("a failed request, a truncated answer and a wrong-shaped answer fail their job, nothing else", async () => {
    const client = fakeClient((requests) =>
      requests.map((request): BatchOutcome => {
        if (request.customId === "errored") {
          return {
            customId: "errored",
            status: "errored",
            error: "overloaded",
          };
        }
        if (request.customId === "cut") {
          return succeeded("cut", '{"answer":', "max_tokens");
        }
        if (request.customId === "shape") {
          return succeeded("shape", '{"wrong":1}', "end_turn");
        }
        return succeeded("fine", '{"answer":"ok"}', "end_turn");
      }),
    );
    const results = await runBatchJobs(
      client,
      ["errored", "cut", "shape", "fine"].map((id) => job(id, false)),
      { budget: new GenerationBudget(5) },
    );
    expect(results.map((result) => result.outcome.status)).toEqual([
      "failed",
      "failed",
      "failed",
      "ok",
    ]);
    expect(results[0]?.outcome).toEqual({
      status: "failed",
      reason: "overloaded",
    });
    expect(results[1]?.outcome).toEqual({
      status: "failed",
      reason: "the answer hit max_tokens",
    });
    expect(results[2]?.outcome).toMatchObject({
      status: "failed",
    });
  });

  test("a round whose worst case does not fit the budget is never submitted", async () => {
    const client = fakeClient(() => []);
    await expect(
      runBatchJobs(client, [job("a")], { budget: new GenerationBudget(1e-9) }),
    ).rejects.toBeInstanceOf(TipBudgetExceededError);
    expect(client.rounds).toHaveLength(0);
  });
});

describe("web search", () => {
  const searching = (id: string): BatchJob<{ answer: string }> => ({
    ...job(id, false),
    search: { type: "web_search_20260209", maxUses: 3 },
  });

  test("grants the run's allowance, declares the tool, records the URLs and takes back what a job did not use", async () => {
    const limit = new SearchLimit(4);
    const client = fakeClient((requests) =>
      requests.map((request) => ({
        customId: request.customId,
        status: "succeeded" as const,
        content: [],
        rawContent: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://example.com/a",
                title: "A page",
              },
            ],
          },
          { type: "text", text: '{"answer":"ok"}' },
        ],
        text: '{"answer":"ok"}',
        stopReason: "end_turn",
        usage: { ...USAGE, webSearchRequests: 1 },
        costUsd: 0.02,
      })),
    );
    const results = await runBatchJobs(
      client,
      [searching("a"), searching("b")],
      { budget: new GenerationBudget(5), searches: limit },
    );
    const tools = client.rounds[0]?.map((request) => request.tools);
    // 4 searches for two jobs that asked for 3 each: the first gets 3, the second 1.
    expect(tools).toEqual([
      [{ type: "web_search_20260209", name: "web_search", maxUses: 3 }],
      [{ type: "web_search_20260209", name: "web_search", maxUses: 1 }],
    ]);
    expect(results.map((result) => result.searches)).toEqual([1, 1]);
    expect(results[0]?.searchUrls).toEqual(["https://example.com/a"]);
    expect(results[0]?.searchTexts).toEqual(["A page"]);
    expect(limit.used).toBe(2);
    expect(limit.grant(10)).toBe(2);
  });

  test("a job gets no search tool once the run's allowance is spent", async () => {
    const limit = new SearchLimit(0);
    const client = fakeClient((requests) =>
      requests.map((request) =>
        succeeded(request.customId, '{"answer":"ok"}', "end_turn"),
      ),
    );
    await runBatchJobs(client, [searching("a")], {
      budget: new GenerationBudget(5),
      searches: limit,
    });
    expect(client.rounds[0]?.[0]?.tools).toBeUndefined();
  });

  test("continues a paused turn by sending its work back", async () => {
    const client = fakeClient((requests, round) =>
      requests.map((request) =>
        round === 1
          ? {
              ...succeeded(request.customId, "", "end_turn"),
              stopReason: "pause_turn",
            }
          : succeeded(request.customId, '{"answer":"ok"}', "end_turn"),
      ),
    );
    const results = await runBatchJobs(client, [searching("a")], {
      budget: new GenerationBudget(5),
    });
    expect(client.rounds).toHaveLength(2);
    expect(results[0]?.outcome).toEqual({
      status: "ok",
      object: { answer: "ok" },
    });
    expect(client.rounds[1]?.[0]?.messages.at(-1)?.role).toBe("assistant");
  });
});

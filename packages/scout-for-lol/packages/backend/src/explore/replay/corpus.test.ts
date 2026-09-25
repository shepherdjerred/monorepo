import { describe, expect, test } from "vitest";
import {
  ReplayCorpusSchema,
  corpusCaseCount,
  corpusIssues,
  parseReplayCorpus,
  replayCorpusSha256,
  type ReplayCorpus,
} from "./corpus.ts";

function turn(index: number, suffix: string) {
  return {
    index,
    questionMessageId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${suffix}`,
    answerMessageId: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${suffix}`,
  };
}

function corpus(overrides: Partial<ReplayCorpus> = {}): ReplayCorpus {
  return ReplayCorpusSchema.parse({
    version: 1,
    stage: "beta",
    capturedAt: "2026-09-20T00:00:00.000Z",
    conversations: [
      {
        conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        leafId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        kind: "question",
        surface: "web",
        guildSource: "beta-allowlist",
        turns: [turn(0, "01"), turn(1, "02")],
        note: "seven-turn sequence where every answer declines",
      },
    ],
    ...overrides,
  });
}

describe("ReplayCorpusSchema", () => {
  test("rejects unknown fields rather than ignoring them", () => {
    expect(() => ReplayCorpusSchema.parse({ ...corpus(), extra: 1 })).toThrow();
  });

  test("requires at least one turn per conversation", () => {
    expect(() =>
      ReplayCorpusSchema.parse({
        ...corpus(),
        conversations: [{ ...corpus().conversations[0], turns: [] }],
      }),
    ).toThrow();
  });

  test("rejects a guild source outside the two that can be established", () => {
    // There is deliberately no "assumed": an unestablished guild is left out
    // at curation time, not run with an empty list.
    expect(() =>
      ReplayCorpusSchema.parse({
        ...corpus(),
        conversations: [
          { ...corpus().conversations[0], guildSource: "assumed" },
        ],
      }),
    ).toThrow();
  });

  test("keeps dare drafts countable apart from natural questions", () => {
    const parsed = ReplayCorpusSchema.parse({
      ...corpus(),
      conversations: [{ ...corpus().conversations[0], kind: "dare-draft" }],
    });
    expect(parsed.conversations[0]?.kind).toBe("dare-draft");
  });
});

describe("corpusIssues", () => {
  test("accepts a well-formed corpus", () => {
    expect(corpusIssues(corpus())).toEqual([]);
  });

  test("rejects a repeated conversation", () => {
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(corpusIssues(corpus({ conversations: [entry, entry] }))).toEqual([
      expect.stringContaining("more than once"),
    ]);
  });

  test("rejects turns out of order, which would replay history wrong", () => {
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(
      corpusIssues(
        corpus({
          conversations: [{ ...entry, turns: [turn(1, "02"), turn(0, "01")] }],
        }),
      ),
    ).toEqual([expect.stringContaining("ascending order")]);
  });

  test("rejects a repeated turn index", () => {
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(
      corpusIssues(
        corpus({
          conversations: [{ ...entry, turns: [turn(0, "01"), turn(0, "02")] }],
        }),
      ),
    ).toEqual([expect.stringContaining("turn index is repeated")]);
  });

  test("rejects the beta allowlist derivation in a prod corpus", () => {
    // Prod has no allowlist, so the derivation that is certain on beta does
    // not exist there.
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(
      corpusIssues(corpus({ stage: "prod", conversations: [entry] })),
    ).toEqual([expect.stringContaining("not valid for a prod corpus")]);
  });

  test("accepts run-payload guild sources on prod", () => {
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(
      corpusIssues(
        corpus({
          stage: "prod",
          conversations: [{ ...entry, guildSource: "run-payload" }],
        }),
      ),
    ).toEqual([]);
  });
});

describe("parseReplayCorpus", () => {
  test("throws with the reasons when a corpus is not replayable", () => {
    const entry = corpus().conversations[0];
    if (entry === undefined) throw new Error("fixture");
    expect(() =>
      parseReplayCorpus({ ...corpus(), conversations: [entry, entry] }),
    ).toThrow(/not replayable/);
  });

  test("returns the corpus when it is sound", () => {
    expect(parseReplayCorpus(corpus()).conversations).toHaveLength(1);
  });
});

describe("corpusCaseCount", () => {
  test("counts turns, not conversations", () => {
    // A seven-turn conversation is seven cases; counting conversations would
    // make a sweep's size wrong by several times.
    expect(corpusCaseCount(corpus())).toBe(2);
  });
});

describe("replayCorpusSha256", () => {
  test("is a stable sha256", () => {
    expect(replayCorpusSha256("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(replayCorpusSha256("x")).toBe(replayCorpusSha256("x"));
  });
});

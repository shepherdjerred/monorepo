import { describe, expect, test } from "vitest";
import {
  ExploreMessageSchema,
  ExploreTranscriptSchema,
  type ExploreMessage,
  type ExploreTranscript,
} from "@scout-for-lol/data";
import { ReplayCorpusEntrySchema, type ReplayCorpusEntry } from "./corpus.ts";
import {
  ReplayPlanError,
  planConversationTurns,
  resolveTurnGuilds,
  type PlanRunRow,
} from "./plan.ts";

const Q0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa00";
const A0 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb00";
const Q1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const A1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const GUILD = "1337623164146155593";

function message(
  id: string,
  role: "user" | "assistant",
  content: string,
  guildIds: readonly string[] = [],
): ExploreMessage {
  return ExploreMessageSchema.parse({
    id,
    role,
    content,
    guildIds,
    createdAt: "2026-09-01T00:00:00.000Z",
  });
}

function transcript(messages: readonly ExploreMessage[]): ExploreTranscript {
  return ExploreTranscriptSchema.parse({
    conversation: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Conversation",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    messages,
  });
}

const FULL = [
  message(Q0, "user", "Who wins most?"),
  message(A0, "assistant", "Ezreal."),
  message(Q1, "user", "And on ARAM?"),
  message(A1, "assistant", "Jinx."),
];

function entry(overrides: Partial<ReplayCorpusEntry> = {}): ReplayCorpusEntry {
  return ReplayCorpusEntrySchema.parse({
    conversationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    leafId: A1,
    kind: "question",
    surface: "web",
    guildSource: "beta-allowlist",
    turns: [
      { index: 0, questionMessageId: Q0, answerMessageId: A0 },
      { index: 1, questionMessageId: Q1, answerMessageId: A1 },
    ],
    note: "two-turn follow-up",
    ...overrides,
  });
}

function runFor(answerId: string, guildIds: readonly string[]): PlanRunRow {
  return {
    resultMessageId: answerId,
    payload: JSON.stringify({
      summary: {},
      started: { question: "q" },
      guildIds,
      surface: "web",
      originChannelId: null,
    }),
  };
}

describe("resolveTurnGuilds", () => {
  test("prefers the answer's own column", () => {
    const resolved = resolveTurnGuilds({
      answer: message(A0, "assistant", "x", ["from-column"]),
      runs: [runFor(A0, ["from-run"])],
      soleAllowedGuildId: "from-allowlist",
    });
    expect(resolved).toEqual({
      guildIds: ["from-column"],
      source: "message-column",
    });
  });

  test("falls back to the run that produced this exact answer", () => {
    const resolved = resolveTurnGuilds({
      answer: message(A0, "assistant", "x"),
      runs: [runFor("other-answer", ["wrong"]), runFor(A0, ["right"])],
      soleAllowedGuildId: null,
    });
    expect(resolved).toEqual({ guildIds: ["right"], source: "run-payload" });
  });

  test("falls back to a stage that admits exactly one guild", () => {
    const resolved = resolveTurnGuilds({
      answer: message(A0, "assistant", "x"),
      runs: [],
      soleAllowedGuildId: GUILD,
    });
    expect(resolved).toEqual({
      guildIds: [GUILD],
      source: "beta-allowlist",
    });
  });

  test("throws rather than running a turn with no guild", () => {
    // An empty list silently strips bucks, dares, challenges and creation, so
    // a capability question would decline for a reason that is not the model.
    expect(() =>
      resolveTurnGuilds({
        answer: message(A0, "assistant", "x"),
        runs: [],
        soleAllowedGuildId: null,
      }),
    ).toThrow(ReplayPlanError);
  });

  test("ignores a run whose payload is unparseable", () => {
    expect(() =>
      resolveTurnGuilds({
        answer: message(A0, "assistant", "x"),
        runs: [{ resultMessageId: A0, payload: "{not json" }],
        soleAllowedGuildId: null,
      }),
    ).toThrow(ReplayPlanError);
  });
});

describe("planConversationTurns", () => {
  const noRuns: readonly PlanRunRow[] = [];
  const base = {
    transcript: transcript(FULL),
    runs: noRuns,
    soleAllowedGuildId: GUILD,
  };

  test("expands each turn with pinned history", () => {
    const turns = planConversationTurns({ entry: entry(), ...base });
    expect(turns).toHaveLength(2);
    expect(turns[0]?.question).toBe("Who wins most?");
    expect(turns[0]?.history).toEqual([]);
    // Turn 1 sees the ORIGINAL answer to turn 0, not a replayed one.
    expect(turns[1]?.question).toBe("And on ARAM?");
    expect(turns[1]?.history.map((m) => m.id)).toEqual([Q0, A0]);
    expect(turns[1]?.baseline.content).toBe("Jinx.");
  });

  test("gives each turn a distinct, conversation-scoped case id", () => {
    const turns = planConversationTurns({ entry: entry(), ...base });
    expect(turns[0]?.caseId).not.toBe(turns[1]?.caseId);
    for (const turn of turns) expect(turn.caseId).toMatch(/^conv:/);
  });

  test("can select a subset of turns", () => {
    const turns = planConversationTurns({
      entry: entry({
        turns: [{ index: 1, questionMessageId: Q1, answerMessageId: A1 }],
      }),
      ...base,
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.turnIndex).toBe(1);
  });

  test("throws when the pinned ids do not match what the leaf resolves to", () => {
    // A regenerated sibling or a moved leaf must not silently change which
    // exchange a case means.
    expect(() =>
      planConversationTurns({
        entry: entry({
          turns: [{ index: 0, questionMessageId: Q0, answerMessageId: Q1 }],
        }),
        ...base,
      }),
    ).toThrow(/corpus pins/);
  });

  test("throws when a turn index is past the end of the path", () => {
    expect(() =>
      planConversationTurns({
        entry: entry({
          turns: [{ index: 9, questionMessageId: Q0, answerMessageId: A0 }],
        }),
        ...base,
      }),
    ).toThrow(/has no turn 9/);
  });

  test("throws when the path does not alternate user then assistant", () => {
    expect(() =>
      planConversationTurns({
        entry: entry({
          turns: [{ index: 0, questionMessageId: Q0, answerMessageId: A0 }],
        }),
        ...base,
        transcript: transcript([
          message(Q0, "user", "a"),
          message(A0, "user", "also a user turn"),
        ]),
      }),
    ).toThrow(/not user\/assistant/);
  });

  test("carries the guild source through so a bundle shows how it was known", () => {
    const turns = planConversationTurns({
      entry: entry(),
      ...base,
      runs: [runFor(A0, ["exact"]), runFor(A1, ["exact"])],
      soleAllowedGuildId: null,
    });
    expect(turns[0]?.guildSource).toBe("run-payload");
    expect(turns[0]?.guildIds).toEqual(["exact"]);
  });
});

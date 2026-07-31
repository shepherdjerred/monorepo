import { describe, expect, test } from "bun:test";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  PersonSchema,
  StyleCardSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import { finalizeStyleSynthesis } from "./glitter-context-refresh-style-finalize.ts";
import {
  STYLE_ARRAY_FIELDS,
  StyleChunkSummarySchema,
  StyleSynthesisSchema,
} from "./glitter-context-refresh-style-schemas.ts";

const person = PersonSchema.parse({
  id: "ryan",
  displayName: "NekoRyan",
  kind: "person",
  aliases: ["Ryan"],
  discordUserIds: ["32345678901234567"],
});

const messages = Array.from({ length: 30 }, (_, index) =>
  CurrentMessageSchema.parse({
    schemaVersion: 1,
    source: "discord-rest",
    guildId: "12345678901234567",
    guildSlug: "glitter-boys",
    channelId: "22345678901234567",
    messageId: String(42_345_678_901_234_500n + BigInt(index)),
    author: {
      id: "32345678901234567",
      username: "nekoryan",
      globalName: "NekoRyan",
      discriminator: "0",
      bot: false,
      avatar: null,
    },
    content: `message ${String(index)} with characteristic phrasing`,
    timestamp: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    editedTimestamp: null,
    type: 0,
    flags: "0",
    pinned: false,
    tts: false,
    attachments: [],
    referencedMessageId: null,
    selectedObservationKey: `observation-${String(index)}`,
    selectedObservedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:01.000Z`,
    rawSha256: index.toString(16).padStart(64, "0"),
  }),
);

const existingCard = StyleCardSchema.parse({
  author: "Ryan",
  coverage: {
    messages: 30,
    date_range: "2026-07",
    notes: "Existing human-reviewed metadata.",
  },
  voice: ["Uses short, direct sentences with playful emphasis."],
  style_markers: ["Frequently opens with a dry acknowledgment."],
  topics: ["Games and plans with the friend group."],
  relationships: ["Warmly teases close friends without hostility."],
  behaviors: ["Answers practical questions directly before joking."],
  personality: ["Comes across as attentive and lightly mischievous."],
  humor_or_tone: ["Dry, understated humor with occasional exaggeration."],
  summary:
    "Ryan writes in a concise, conversational style that mixes practical answers with familiar teasing.",
  likes_dislikes: ["Enjoys coordinated games and dislikes needless delay."],
  league: {
    playstyle: "Prefers coordinated team play.",
  },
  other_games: ["Regularly discusses multiplayer games with friends."],
  how_to_mimic: ["Be concise, answer first, then add one dry joke."],
  quotes: [],
  sample_messages: [],
  concerns: ["Avoid inferring private traits from casual jokes."],
});

const retainedPatches = STYLE_ARRAY_FIELDS.map((field) => ({
  field,
  priorDecisions: [
    {
      priorIndex: 0,
      decision: "retain",
      removalBasis: null,
      confidence: 0.9,
      rationale: null,
      evidenceMessageIds: [messages[0]?.messageId],
    },
  ],
  additions: [],
}));

const retainedDecision = {
  priorIndex: 0,
  decision: "retain" as const,
  removalBasis: null,
  confidence: 0.9,
  rationale: null,
  evidenceMessageIds: [messages[0]?.messageId],
};

const situationalExamples = {
  provenance: "synthetic" as const,
  happy_or_excited: ["happy one", "happy two", "happy three"],
  angry_or_frustrated: ["angry one", "angry two", "angry three"],
  sad_or_disappointed: ["sad one", "sad two", "sad three"],
  supportive_or_caring: [
    "supportive one",
    "supportive two",
    "supportive three",
  ],
  playful_or_teasing: ["playful one", "playful two", "playful three"],
  neutral_or_logistical: ["neutral one", "neutral two", "neutral three"],
};

const synthesis = StyleSynthesisSchema.parse({
  patches: retainedPatches,
  summaryPatch: {
    priorDecisions: [retainedDecision],
    additions: [],
  },
  leaguePatch: {
    priorDecisions: [retainedDecision],
    additions: [],
  },
  quoteMessageIds: messages.slice(0, 20).map((message) => message.messageId),
  sampleMessageIds: messages.map((message) => message.messageId),
  situational_examples: situationalExamples,
});

const candidate = {
  person,
  messages,
  safeMessages: messages,
  directRecentMessages: messages,
  newMessageCount: 30,
  totalMessageCount: 30,
};
const firstTimestamp = CurrentMessageSchema.parse(messages[0]).timestamp;
const lastTimestamp = CurrentMessageSchema.parse(messages.at(-1)).timestamp;

describe("Glitter generated style-card schemas", () => {
  test("convert to OpenAI strict Structured Outputs schemas", () => {
    expect(() =>
      zodResponseFormat(StyleChunkSummarySchema, "style_chunk_summary"),
    ).not.toThrow();
    expect(() =>
      zodResponseFormat(StyleSynthesisSchema, "style_card_synthesis"),
    ).not.toThrow();
  });

  test("finalizes a V2 card while preserving reviewed prose verbatim", () => {
    const result = finalizeStyleSynthesis({
      candidate,
      existingCard,
      sourceSnapshotSha256: "a".repeat(64),
      chunkCount: 1,
      synthesis,
    });

    expect(result.schemaVersion).toBe(2);
    expect(result.author).toBe("Ryan");
    expect(result.voice).toEqual(existingCard.voice);
    expect(result.summary).toEqual(
      typeof existingCard.summary === "string"
        ? [existingCard.summary]
        : existingCard.summary,
    );
    expect(result.league).toEqual(existingCard.league);
    expect(result.quotes).toEqual(
      messages.slice(0, 20).map((message) => message.content),
    );
    expect(result.sample_messages).toEqual(
      messages.map((message) => message.content),
    );
    expect(result.situational_examples).toEqual(situationalExamples);
    expect(result.coverage).toEqual({
      source_snapshot_sha256: "a".repeat(64),
      corpus: {
        messages: 30,
        date_range: {
          start: firstTimestamp,
          end: lastTimestamp,
        },
      },
      evidence: {
        safe_messages: 30,
        summarized_messages: 30,
        chunks: 1,
        direct_recent_messages: 30,
        date_range: {
          start: firstTimestamp,
          end: lastTimestamp,
        },
        strategy: "all-safe-monthly-chunks-plus-latest-500",
      },
      notes:
        "Generated from the checksum-verified Discord corpus; human review required.",
    });
  });

  test("rejects evidence IDs that are not in the safe corpus", () => {
    const invalidSynthesis = StyleSynthesisSchema.parse({
      ...synthesis,
      quoteMessageIds: [
        "99999999999999999",
        ...synthesis.quoteMessageIds.slice(1),
      ],
    });

    expect(() =>
      finalizeStyleSynthesis({
        candidate,
        existingCard,
        sourceSnapshotSha256: "a".repeat(64),
        chunkCount: 1,
        synthesis: invalidSynthesis,
      }),
    ).toThrow("quotes cites unknown message IDs");
  });

  test("requires evidence-backed decisions for summary and League prose", () => {
    const invalidSynthesis = StyleSynthesisSchema.parse({
      ...synthesis,
      summaryPatch: {
        priorDecisions: [],
        additions: [],
      },
    });

    expect(() =>
      finalizeStyleSynthesis({
        candidate,
        existingCard,
        sourceSnapshotSha256: "a".repeat(64),
        chunkCount: 1,
        synthesis: invalidSynthesis,
      }),
    ).toThrow(
      "style synthesis did not decide every prior summary observation exactly once",
    );
  });
});

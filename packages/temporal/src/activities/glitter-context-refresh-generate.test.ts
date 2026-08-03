import { describe, expect, mock, test } from "bun:test";
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
import * as glitterOpenai from "./glitter-context-refresh-openai.ts";
import { GenerationBudget } from "./glitter-context-refresh-budget.ts";
import type { GenerationArtifactStore } from "./glitter-context-refresh-cache.ts";

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

// The extraction/synthesis repair loop: gpt-5.6 occasionally cites a message ID
// outside its supplied evidence set, and because completions are cached before
// validation a fixed-seed retry would re-read the same poisoned artifact and
// fail forever. Each repair attempt must use a distinct seed so it is a fresh,
// cache-distinct call — a re-run then reuses the first attempt that passed.
const firstMessage = CurrentMessageSchema.parse(messages[0]);

const goodChunkSummary = {
  observations: [
    {
      field: "voice" as const,
      claim: "Writes concise, direct sentences.",
      confidence: 0.9,
      evidenceMessageIds: [firstMessage.messageId],
    },
  ],
  representativeMessages: [
    { messageId: firstMessage.messageId, content: firstMessage.content },
  ],
};

const badChunkSummary = {
  observations: [
    {
      field: "voice" as const,
      claim: "Cites a message from outside the supplied chunk.",
      confidence: 0.9,
      evidenceMessageIds: ["99999999999999999"],
    },
  ],
  representativeMessages: [],
};

const mockUsage = { prompt_tokens: 100, completion_tokens: 50 };

let chunkResponder: (call: number) => unknown = () => goodChunkSummary;
let chunkCallCount = 0;
let recordedSeeds: number[] = [];

await mock.module("./glitter-context-refresh-openai.ts", () => ({
  ...glitterOpenai,
  parseGlitterCompletion: (callSite: string, params: { seed: number }) => {
    if (callSite.startsWith("glitter-style-chunk")) {
      recordedSeeds.push(params.seed);
      const parsed = chunkResponder(chunkCallCount);
      chunkCallCount += 1;
      return Promise.resolve({
        choices: [{ message: { parsed, content: null } }],
        usage: mockUsage,
      });
    }
    return Promise.resolve({
      choices: [{ message: { parsed: synthesis, content: null } }],
      usage: mockUsage,
    });
  },
}));

const { generateStyleCard } =
  await import("./glitter-context-refresh-style-generation.ts");

function memoryStore(): GenerationArtifactStore {
  const values = new Map<string, unknown>();
  return {
    ownerRunId: "11111111-1111-4111-8111-111111111111",
    read: (key) => Promise.resolve(values.get(key)),
    create: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("Glitter extraction repair loop", () => {
  test("retries a poisoned chunk with a fresh seed and succeeds", async () => {
    chunkCallCount = 0;
    recordedSeeds = [];
    // Attempt 0 (seed 0) cites an unknown ID; the repair (seed 1) is clean.
    chunkResponder = (call) =>
      call === 0 ? badChunkSummary : goodChunkSummary;

    const result = await generateStyleCard({
      candidate,
      existingCard,
      sourceSnapshotSha256: "a".repeat(64),
      artifactStore: memoryStore(),
      budget: new GenerationBudget(100),
    });

    expect(result.schemaVersion).toBe(2);
    // Initial attempt seed 0, one repair at seed 1 — distinct seeds, so the
    // repair is a genuinely fresh (cache-distinct) model call.
    expect(recordedSeeds).toEqual([0, 1]);
  });

  test("throws after exhausting the bounded repair attempts", async () => {
    chunkCallCount = 0;
    recordedSeeds = [];
    chunkResponder = () => badChunkSummary;

    await expect(
      generateStyleCard({
        candidate,
        existingCard,
        sourceSnapshotSha256: "a".repeat(64),
        artifactStore: memoryStore(),
        budget: new GenerationBudget(100),
      }),
    ).rejects.toThrow("cites unknown message IDs");

    // Initial attempt (seed 0) plus MAX_EXTRACTION_REPAIR_ATTEMPTS repairs,
    // each with a distinct escalating seed.
    expect(recordedSeeds).toEqual([0, 1, 2, 3, 4]);
  });
});

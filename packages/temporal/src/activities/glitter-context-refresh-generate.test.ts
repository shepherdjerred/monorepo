import { describe, expect, test, vi } from "vitest";
import {
  PersonSchema,
  StyleCardSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import { GlitterEvidenceError } from "./glitter-context-refresh-evidence-error.ts";
import { finalizeStyleSynthesis } from "./glitter-context-refresh-style-finalize.ts";
import {
  STYLE_ARRAY_FIELDS,
  StyleChunkSummarySchema,
  StyleSynthesisSchema,
} from "./glitter-context-refresh-style-schemas.ts";
import * as glitterLlm from "./glitter-context-refresh-llm.ts";
import {
  sanitizeChunkSummary,
  validateChunkSummary,
} from "./glitter-context-refresh-style-validation.ts";
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
const summarizedChunk = {
  key: "person:2025-01",
  month: "2025-01",
  startTimestamp: firstTimestamp,
  endTimestamp: lastTimestamp,
  summary: StyleChunkSummarySchema.parse({
    observations: [],
    representativeMessages: [
      {
        messageId: messages[0]?.messageId,
        content: messages[0]?.content,
      },
    ],
  }),
  summarizedMessageCount: 30,
};
const completeEvidence = {
  chunks: [summarizedChunk],
  directRecentMessages: messages,
  omittedChunks: 0,
  omittedSummarizedMessages: 0,
  omittedDirectRecentMessages: 0,
};

describe("Glitter generated style-card schemas", () => {
  test("use strict Zod contracts for OpenRouter structured output", () => {
    expect(StyleChunkSummarySchema.safeParse(goodChunkSummary).success).toBe(
      true,
    );
    expect(StyleSynthesisSchema.safeParse(synthesis).success).toBe(true);
  });

  test("finalizes a V2 card while preserving reviewed prose verbatim", () => {
    const result = finalizeStyleSynthesis({
      candidate,
      existingCard,
      sourceSnapshotSha256: "a".repeat(64),
      ...completeEvidence,
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
        omitted_summarized_messages: 0,
        omitted_chunks: 0,
        omitted_direct_recent_messages: 0,
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

  test("records bounded omissions and the actual synthesis evidence range", () => {
    const olderMessage = CurrentMessageSchema.parse({
      ...messages[0],
      messageId: "42345678901234499",
      timestamp: "2026-06-01T00:00:00.000Z",
      selectedObservedAt: "2026-06-01T00:00:01.000Z",
      selectedObservationKey: "older-observation",
      rawSha256: "f".repeat(64),
    });
    const boundedCandidate = {
      ...candidate,
      messages: [olderMessage, ...messages],
      safeMessages: [olderMessage, ...messages],
      totalMessageCount: 31,
    };

    const result = finalizeStyleSynthesis({
      candidate: boundedCandidate,
      existingCard,
      sourceSnapshotSha256: "a".repeat(64),
      chunks: [],
      directRecentMessages: messages,
      omittedChunks: 1,
      omittedSummarizedMessages: 1,
      omittedDirectRecentMessages: 1,
      synthesis,
    });

    expect(result.coverage.evidence).toMatchObject({
      safe_messages: 31,
      summarized_messages: 0,
      chunks: 0,
      direct_recent_messages: 30,
      omitted_summarized_messages: 1,
      omitted_chunks: 1,
      omitted_direct_recent_messages: 1,
      date_range: {
        start: firstTimestamp,
        end: lastTimestamp,
      },
      strategy: "bounded-safe-monthly-chunks-plus-latest-direct",
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
        ...completeEvidence,
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
        ...completeEvidence,
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

// Fails validation (one observation cites an unknown ID) but sanitizes to a
// non-empty result because a second observation is fully verifiable.
const partiallyBadChunkSummary = {
  observations: [
    {
      field: "voice" as const,
      claim: "Fully verifiable — survives sanitization.",
      confidence: 0.9,
      evidenceMessageIds: [firstMessage.messageId],
    },
    {
      field: "topics" as const,
      claim: "Cites a message from outside the supplied chunk.",
      confidence: 0.9,
      evidenceMessageIds: ["99999999999999999"],
    },
  ],
  representativeMessages: [],
};

const mockUsage = {
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  costUsd: 0.001,
};

let chunkResponder: (call: number) => unknown = () => goodChunkSummary;
let chunkCallCount = 0;
let recordedSeeds: number[] = [];
// Synthesis calls whose max_completion_tokens is below this threshold report a
// length truncation (0 = never truncate).
let recordedSynthesisTokenLimits: {
  initial: number;
  semanticRetry: number | undefined;
}[] = [];
let lastGenerationBudget: GenerationBudget | undefined;

await vi.doMock("./glitter-context-refresh-llm.ts", () => ({
  ...glitterLlm,
  generateGlitterObject: (input: {
    workload: string;
    seed: number;
    maxOutputTokens: number;
    semanticRetryMaxOutputTokens?: number | undefined;
  }) => {
    if (input.workload.startsWith("glitter-style-chunk")) {
      recordedSeeds.push(input.seed);
      const parsed = chunkResponder(chunkCallCount);
      chunkCallCount += 1;
      return Promise.resolve({
        response: { outcome: "success" as const, value: parsed },
        usage: mockUsage,
      });
    }
    recordedSynthesisTokenLimits.push({
      initial: input.maxOutputTokens,
      semanticRetry: input.semanticRetryMaxOutputTokens,
    });
    return Promise.resolve({
      response: { outcome: "success" as const, value: synthesis },
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

function generateWithStubbedModel(responder: (call: number) => unknown) {
  chunkCallCount = 0;
  recordedSeeds = [];
  chunkResponder = responder;
  const budget = new GenerationBudget(100);
  lastGenerationBudget = budget;
  return generateStyleCard({
    candidate,
    existingCard,
    sourceSnapshotSha256: "a".repeat(64),
    artifactStore: memoryStore(),
    budget,
  });
}

// A second UTC month, so `buildStyleEvidenceChunks` produces two chunks. The
// original messages stay first so the synthesis fixture's quote/sample IDs
// remain inside the safe corpus.
const secondMonthMessages = Array.from({ length: 30 }, (_, index) =>
  CurrentMessageSchema.parse({
    ...CurrentMessageSchema.parse(messages[0]),
    messageId: String(52_345_678_901_234_500n + BigInt(index)),
    content: `august message ${String(index)} with characteristic phrasing`,
    timestamp: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }),
);

function generateAcrossTwoMonths(responder: (call: number) => unknown) {
  chunkCallCount = 0;
  recordedSeeds = [];
  chunkResponder = responder;
  const budget = new GenerationBudget(100);
  lastGenerationBudget = budget;
  const twoMonthMessages = [...messages, ...secondMonthMessages];
  return generateStyleCard({
    candidate: {
      ...candidate,
      messages: twoMonthMessages,
      safeMessages: twoMonthMessages,
      totalMessageCount: twoMonthMessages.length,
    },
    existingCard,
    sourceSnapshotSha256: "a".repeat(64),
    artifactStore: memoryStore(),
    budget,
  });
}

// Same as above but with no direct recent messages either, so the model would
// see nothing at all.
function generateWithoutAnyEvidence() {
  chunkCallCount = 0;
  recordedSeeds = [];
  chunkResponder = () => badChunkSummary;
  return generateStyleCard({
    candidate: { ...candidate, directRecentMessages: [] },
    existingCard,
    sourceSnapshotSha256: "a".repeat(64),
    artifactStore: memoryStore(),
    budget: new GenerationBudget(100),
  });
}

describe("Glitter extraction repair loop", () => {
  test("retries a poisoned chunk with a fresh seed and succeeds", async () => {
    // Attempt 0 (seed 0) cites an unknown ID; the repair (seed 1) is clean.
    const result = await generateWithStubbedModel((call) =>
      call === 0 ? badChunkSummary : goodChunkSummary,
    );

    expect(result.schemaVersion).toBe(2);
    // Initial attempt seed 0, one repair at seed 1 — distinct seeds, so the
    // repair is a genuinely fresh (cache-distinct) model call.
    expect(recordedSeeds).toEqual([0, 1]);
  });

  test("sanitizes a partially-unfixable chunk and completes the run", async () => {
    // Every attempt has one observation that deterministically cites an unknown
    // ID (the systematic in-content-ID case) plus one fully-verifiable one.
    // Repairs can never fix the bad observation, so after the bounded budget the
    // chunk is sanitized to its verifiable subset and the run completes.
    const result = await generateWithStubbedModel(
      () => partiallyBadChunkSummary,
    );

    // Run completes rather than throwing.
    expect(result.schemaVersion).toBe(2);
    // Initial attempt (seed 0) plus MAX_EXTRACTION_REPAIR_ATTEMPTS (2) repairs,
    // then sanitization — no unbounded retrying.
    expect(recordedSeeds).toEqual([0, 1, 2]);
  });

  test("counts a sanitized chunk's messages — the chunk still yielded evidence", async () => {
    // Sanitization dropped one observation, but the model did read and summarize
    // this chunk, so its messages legitimately back the card.
    const result = await generateWithStubbedModel(
      () => partiallyBadChunkSummary,
    );

    expect(result.coverage.evidence.summarized_messages).toBe(30);
    expect(result.coverage.evidence.safe_messages).toBe(30);
  });

  test("still builds a card from direct evidence when every chunk degrades", async () => {
    // Chunk summaries are not the only evidence the model sees: synthesis also
    // receives the candidate's verbatim directRecentMessages, and finalize
    // validates every quoted and sampled ID against the safe corpus regardless.
    // So a dead chunk costs coverage, not the whole person.
    const result = await generateWithStubbedModel(() => badChunkSummary);

    expect(result.schemaVersion).toBe(2);
    expect(result.coverage.evidence.summarized_messages).toBe(0);
    expect(result.coverage.evidence.direct_recent_messages).toBe(30);
    // Still bounded: initial attempt plus MAX_EXTRACTION_REPAIR_ATTEMPTS repairs.
    expect(recordedSeeds).toEqual([0, 1, 2]);
  });

  test("rejects a person the model would see no evidence for at all", async () => {
    // Chunks all degraded AND no direct recent messages: synthesis would be
    // asked to write a card from nothing, which is fabrication rather than a
    // refresh.
    //
    // The TYPE matters as much as the message: the refresh activity skips a
    // person on `GlitterEvidenceError` and lets everything else escape to
    // Temporal's retry, so a plain Error here would make a storage blip
    // indistinguishable from unusable evidence.
    await expect(generateWithoutAnyEvidence()).rejects.toThrow(
      GlitterEvidenceError,
    );
    await expect(generateWithoutAnyEvidence()).rejects.toThrow(
      "no evidence for ryan",
    );
  });

  test("degrades one dead chunk and keeps its messages out of coverage", async () => {
    // Two months, so two chunks. The first yields evidence; the second is
    // deterministically unverifiable and degrades to nothing. The run must still
    // produce a card, and coverage must count only the month that contributed —
    // claiming all 60 would advertise a month the card silently omits.
    const result = await generateAcrossTwoMonths((call) =>
      call === 0 ? goodChunkSummary : badChunkSummary,
    );

    expect(result.schemaVersion).toBe(2);
    expect(result.coverage.evidence.chunks).toBe(2);
    expect(result.coverage.evidence.safe_messages).toBe(60);
    expect(result.coverage.evidence.summarized_messages).toBe(30);
  });

  test("keeps an earlier attempt's evidence when a later repair sanitizes to nothing", async () => {
    // Repairs are non-monotonic: attempt 0 has a verifiable observation, but the
    // later repairs cite only unknown IDs and would sanitize to nothing. The
    // fallback must keep attempt 0's evidence rather than failing on the empty
    // final attempt.
    const result = await generateWithStubbedModel((call) =>
      call === 0 ? partiallyBadChunkSummary : badChunkSummary,
    );

    expect(result.schemaVersion).toBe(2);
    expect(recordedSeeds).toEqual([0, 1, 2]);
  });
});

describe("Glitter synthesis truncation retry", () => {
  test("raises the token cap inside the bounded semantic retry budget", async () => {
    recordedSynthesisTokenLimits = [];
    const result = await generateWithStubbedModel(() => goodChunkSummary);
    expect(result.schemaVersion).toBe(2);
    expect(recordedSynthesisTokenLimits).toContainEqual({
      initial: 28_000,
      semanticRetry: 40_000,
    });
    const synthesisArtifactKeys = lastGenerationBudget
      ?.summary()
      .artifactKeys.filter((key) => key.includes("glitter-style-synthesis"));
    expect(synthesisArtifactKeys).toHaveLength(1);
  });
});

describe("sanitizeChunkSummary", () => {
  const chunk = {
    key: "2026-07-0000",
    month: "2026-07",
    ordinal: 0,
    messages,
  };

  test("keeps only fully-verifiable observations and drops the rest", () => {
    const knownId = firstMessage.messageId;
    const secondKnownId = CurrentMessageSchema.parse(messages[1]).messageId;
    const summary = StyleChunkSummarySchema.parse({
      observations: [
        {
          field: "voice",
          claim: "Kept: every cited ID is verifiable.",
          confidence: 0.9,
          evidenceMessageIds: [knownId, secondKnownId],
        },
        {
          field: "topics",
          claim: "Dropped whole: a mixed citation must not be laundered.",
          confidence: 0.9,
          evidenceMessageIds: [knownId, "99999999999999999"],
        },
        {
          field: "behaviors",
          claim: "Dropped: only cites an unverifiable in-content ID.",
          confidence: 0.9,
          evidenceMessageIds: ["88888888888888888"],
        },
      ],
      representativeMessages: [
        { messageId: knownId, content: firstMessage.content },
        { messageId: knownId, content: "not the real content" },
      ],
    });

    const sanitized = sanitizeChunkSummary(chunk, summary);

    // Only the fully-verifiable observation survives; the mixed-citation one is
    // dropped whole (never laundered onto its surviving ID) and so is the
    // fully-unverifiable one.
    expect(sanitized.observations).toHaveLength(1);
    expect(sanitized.observations[0]?.field).toBe("voice");
    expect(sanitized.observations[0]?.evidenceMessageIds).toEqual([
      knownId,
      secondKnownId,
    ]);
    // The non-verbatim representative is dropped; the verbatim one survives.
    expect(sanitized.representativeMessages).toEqual([
      { messageId: knownId, content: firstMessage.content },
    ]);
    // The sanitized result satisfies the strict validator by construction.
    expect(() => validateChunkSummary(chunk, sanitized)).not.toThrow();
  });
});

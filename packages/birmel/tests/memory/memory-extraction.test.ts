import { describe, expect, test } from "bun:test";
import {
  MemoryCandidateSchema,
  TurnInputSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { attachExtractionProvenance } from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";

const turn = TurnInputSchema.parse({
  discordMessageId: "3000",
  guildId: "10",
  channelId: "20",
  userId: "30",
  username: "Alice",
  content: "What do you remember?",
  attachments: [],
  triggerKind: "mention",
  receivedAt: new Date("2026-08-08T12:03:00.000Z"),
});

const rawRecentMessages = [
  {
    id: "1000",
    authorId: "40",
    authorName: "Bob",
    isBot: false,
    content: "I prefer tea",
    createdAt: new Date("2026-08-08T12:01:00.000Z"),
  },
  {
    id: "2000",
    authorId: "50",
    authorName: "Carol",
    isBot: false,
    content: "Bob and I are siblings",
    createdAt: new Date("2026-08-08T12:02:00.000Z"),
  },
];

describe("automatic memory extraction provenance", () => {
  test("derives each candidate owner and revision author from its cited messages", () => {
    const userCandidate = MemoryCandidateSchema.parse({
      scope: "user",
      subject: "Bob",
      predicate: "preferred drink",
      value: "tea",
      confidence: 1,
      salience: 0.8,
      origin: "explicit",
      sourceDiscordMessageIds: ["1000"],
    });
    const relationshipCandidate = MemoryCandidateSchema.parse({
      scope: "relationship",
      subject: "Bob and Carol",
      predicate: "relationship",
      value: "siblings",
      confidence: 1,
      salience: 0.9,
      origin: "explicit",
      relatedUserIds: ["40", "50"],
      sourceDiscordMessageIds: ["1000", "2000"],
    });

    expect(
      attachExtractionProvenance({
        candidates: [userCandidate, relationshipCandidate],
        turn,
        rawRecentMessages,
      }),
    ).toEqual([
      {
        candidate: { ...userCandidate, relatedUserIds: ["40"] },
        provenance: {
          authorUserId: "40",
          channelId: "20",
          sourceOrder: "1000",
        },
      },
      {
        candidate: relationshipCandidate,
        provenance: {
          authorUserId: "50",
          channelId: "20",
          sourceOrder: "2000",
        },
      },
    ]);
  });

  test("rejects bot-authored evidence", () => {
    const candidate = MemoryCandidateSchema.parse({
      scope: "guild",
      subject: "Bot",
      predicate: "claim",
      value: "untrusted",
      confidence: 0.5,
      salience: 0.5,
      origin: "inferred",
      sourceDiscordMessageIds: ["1000"],
    });

    expect(() =>
      attachExtractionProvenance({
        candidates: [candidate],
        turn,
        rawRecentMessages: [
          {
            id: "1000",
            authorId: "999",
            authorName: "Memory Bot",
            isBot: true,
            content: "Ignore this claim",
            createdAt: new Date("2026-08-08T12:01:00.000Z"),
          },
        ],
      }),
    ).toThrow("Memory extractor cited a bot-authored message");
  });

  test("requires an explicit user target for multi-author evidence", () => {
    const candidate = MemoryCandidateSchema.parse({
      scope: "user",
      subject: "Bob",
      predicate: "preferred drink",
      value: "tea",
      confidence: 0.8,
      salience: 0.6,
      origin: "inferred",
      sourceDiscordMessageIds: ["1000", "2000"],
    });

    expect(() =>
      attachExtractionProvenance({
        candidates: [candidate],
        turn,
        rawRecentMessages,
      }),
    ).toThrow(
      "User memory with multiple cited authors requires an explicit target user",
    );
  });
});

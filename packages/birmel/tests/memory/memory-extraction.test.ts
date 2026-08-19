import { describe, expect, test } from "bun:test";
import {
  MemoryCandidateSchema,
  TurnInputSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { attachExtractionProvenance } from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";
import {
  attachSelfMemoryProvenance,
  buildExtractionTranscript,
  SelfMemorySchema,
} from "@shepherdjerred/birmel/agent-runtime/memory-extraction.ts";

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
const aliasTurn = TurnInputSchema.parse({
  ...turn,
  content: "Can I call you Compyutah?",
});
const assistantMessage = {
  id: "4000",
  userId: "60",
  content: "Yes, you can call me Compyutah.",
};

describe("automatic memory extraction provenance", () => {
  test("does not expose arbitrary prior bot text to memory extraction", () => {
    const transcript = buildExtractionTranscript(
      [
        ...rawRecentMessages,
        {
          id: "2500",
          authorId: "999",
          authorName: "Memory Bot",
          isBot: true,
          content: "Birmel promised to invent an integration",
          createdAt: new Date("2026-08-08T12:02:30.000Z"),
        },
      ],
      turn,
    );

    expect(transcript).toContain("I prefer tea");
    expect(transcript).toContain("What do you remember?");
    expect(transcript).not.toContain("invent an integration");
    expect(transcript).not.toContain("2500");
  });

  test("derives each candidate owner and revision author from its cited messages", () => {
    const userCandidate = MemoryCandidateSchema.parse({
      scope: "user",
      subject: "Bob",
      predicate: "preferred drink",
      value: "tea",
      confidence: 1,
      salience: 0.8,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
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
      validFrom: null,
      validUntil: null,
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
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
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
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
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

  test("does not let human claims create persona wake aliases", () => {
    const candidate = MemoryCandidateSchema.parse({
      scope: "persona",
      subject: "alias:compyutah",
      predicate: "identity.alias",
      value: "Compyutah",
      confidence: 1,
      salience: 1,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
      sourceDiscordMessageIds: ["1000"],
    });

    expect(
      attachExtractionProvenance({
        candidates: [candidate],
        turn,
        rawRecentMessages,
      }),
    ).toEqual([]);
  });
});

describe("curated alias provenance", () => {
  test("turns an accepted alias into canonical persona memory with paired provenance", () => {
    const result = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Compyutah",
          confidence: 1,
          salience: 1,
        }),
      ],
      turn: aliasTurn,
      assistantMessage,
      toolEvents: [],
    });

    expect(result).toEqual({
      rejectedCount: 0,
      candidates: [
        {
          candidate: {
            scope: "persona",
            subject: "alias:compyutah",
            predicate: "identity.alias",
            value: "Compyutah",
            confidence: 1,
            salience: 1,
            origin: "explicit",
            validFrom: null,
            validUntil: null,
            relatedUserIds: [],
            sourceDiscordMessageIds: ["3000", "4000"],
          },
          provenance: {
            authorUserId: "60",
            channelId: "20",
            sourceOrder: "4000",
          },
        },
      ],
    });
  });

  test("rejects incidental and overly broad aliases independently", () => {
    const result = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Google",
          confidence: 1,
          salience: 1,
        }),
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Compyutah",
          confidence: 1,
          salience: 1,
        }),
      ],
      turn: {
        ...aliasTurn,
        content: "Can I call you Compyutah? Can you Google something?",
      },
      assistantMessage: {
        ...assistantMessage,
        content: "You can call me Compyutah. I can Google nothing directly.",
      },
      toolEvents: [],
    });

    expect(result.rejectedCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidate.value).toBe("Compyutah");
  });

  test("persists accepted aliases with canonical internal whitespace", () => {
    const result = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "Compyutah\t  Prime",
          confidence: 1,
          salience: 1,
        }),
      ],
      turn: {
        ...aliasTurn,
        content: "Can I call you Compyutah Prime?",
      },
      assistantMessage: {
        ...assistantMessage,
        content: "Yes, you can call me Compyutah Prime.",
      },
      toolEvents: [],
    });

    expect(result.candidates[0]?.candidate).toMatchObject({
      subject: "alias:compyutah prime",
      value: "Compyutah Prime",
    });
  });

  test("rejects negated alias proposals and acceptance phrases", () => {
    const alias = SelfMemorySchema.parse({
      kind: "accepted-alias",
      alias: "Nova",
      confidence: 1,
      salience: 1,
    });
    const rejectedProposal = attachSelfMemoryProvenance({
      selfMemories: [alias],
      turn: { ...aliasTurn, content: "I will not call you Nova." },
      assistantMessage: {
        ...assistantMessage,
        content: "You can call me Nova.",
      },
      toolEvents: [],
    });
    const rejectedAcceptance = attachSelfMemoryProvenance({
      selfMemories: [alias],
      turn: { ...aliasTurn, content: "Can I call you Nova?" },
      assistantMessage: {
        ...assistantMessage,
        content: "I will not answer to Nova, so do not call me Nova.",
      },
      toolEvents: [],
    });

    expect(rejectedProposal).toEqual({ candidates: [], rejectedCount: 1 });
    expect(rejectedAcceptance).toEqual({ candidates: [], rejectedCount: 1 });
  });
});

describe("curated self-memory provenance", () => {
  test("accepts guild, persona, and targeted-user commitments", () => {
    const scopes = [
      { scope: "guild", targetUserId: null },
      { scope: "persona", targetUserId: null },
      { scope: "user", targetUserId: "30" },
    ];
    const result = attachSelfMemoryProvenance({
      selfMemories: scopes.map(({ scope, targetUserId }) =>
        SelfMemorySchema.parse({
          kind: "commitment",
          scope,
          targetUserId,
          commitment: "I will remember and follow through.",
          topic: "remember and follow through",
          confidence: 1,
          salience: 0.9,
          validFrom: null,
          validUntil: null,
        }),
      ),
      turn,
      assistantMessage: {
        ...assistantMessage,
        content: "I will remember and follow through.",
      },
      toolEvents: [],
    });

    expect(result.candidates.map(({ candidate }) => candidate.scope)).toEqual([
      "guild",
      "persona",
      "user",
    ]);
    expect(result.candidates[2]?.candidate.relatedUserIds).toEqual(["30"]);
    expect(
      result.candidates.map(({ candidate }) => candidate.predicate),
    ).toEqual(["commitment", "commitment", "commitment"]);
  });

  test("rejects fabricated commitments and ungrounded target users", () => {
    const result = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "commitment",
          scope: "guild",
          targetUserId: null,
          commitment: "I will invent a Scout integration.",
          topic: "Scout integration",
          confidence: 1,
          salience: 1,
          validFrom: null,
          validUntil: null,
        }),
        SelfMemorySchema.parse({
          kind: "commitment",
          scope: "user",
          targetUserId: "999",
          commitment: "I will remember and follow through.",
          topic: "remember and follow through",
          confidence: 1,
          salience: 1,
          validFrom: null,
          validUntil: null,
        }),
      ],
      turn,
      assistantMessage: {
        ...assistantMessage,
        content: "I will remember and follow through.",
      },
      toolEvents: [],
    });

    expect(result).toEqual({ candidates: [], rejectedCount: 2 });
  });
});

describe("verified tool self-memory", () => {
  test("requires a matching successful tool event for self experience", () => {
    const experience = SelfMemorySchema.parse({
      kind: "verified-tool-experience",
      toolId: "connect-github",
      toolCallId: "call-connect-status",
      scope: "persona",
      targetUserId: null,
      subject: "GitHub connection",
      predicate: "verified status with",
      value: "GitHub account is connected",
      confidence: 1,
      salience: 0.7,
      validFrom: null,
      validUntil: null,
    });
    const successfulToolEvent = {
      toolCallId: "call-connect-status",
      toolId: "connect-github",
      inputSummary: '{"action":"status"}',
      resultSummary: "GitHub account is connected",
      content: "Tool connect-github succeeded",
      success: true,
    };

    expect(
      attachSelfMemoryProvenance({
        selfMemories: [experience],
        turn,
        assistantMessage,
        toolEvents: [
          {
            toolCallId: "call-connect-status",
            toolId: "connect-github",
            inputSummary: '{"action":"status"}',
            resultSummary: "Tool reported failure",
            content: "Tool connect-github failed",
            success: false,
          },
        ],
      }),
    ).toEqual({ candidates: [], rejectedCount: 1 });

    const fabricatedExperience = SelfMemorySchema.parse({
      ...experience,
      value: "Created ten pull requests",
    });
    expect(
      attachSelfMemoryProvenance({
        selfMemories: [fabricatedExperience],
        turn,
        assistantMessage,
        toolEvents: [successfulToolEvent],
      }),
    ).toEqual({ candidates: [], rejectedCount: 1 });

    expect(
      attachSelfMemoryProvenance({
        selfMemories: [experience],
        turn,
        assistantMessage,
        toolEvents: [successfulToolEvent],
      }).candidates,
    ).toHaveLength(1);

    const currentUserExperience = SelfMemorySchema.parse({
      ...experience,
      scope: "user",
      targetUserId: turn.userId,
    });
    const unrelatedUserExperience = SelfMemorySchema.parse({
      ...currentUserExperience,
      targetUserId: "999",
    });
    expect(
      attachSelfMemoryProvenance({
        selfMemories: [currentUserExperience],
        turn,
        assistantMessage,
        toolEvents: [successfulToolEvent],
      }).candidates[0]?.candidate.relatedUserIds,
    ).toEqual([turn.userId]);
    expect(
      attachSelfMemoryProvenance({
        selfMemories: [unrelatedUserExperience],
        turn,
        assistantMessage,
        toolEvents: [successfulToolEvent],
      }),
    ).toEqual({ candidates: [], rejectedCount: 1 });

    const reservedAliasExperience = SelfMemorySchema.parse({
      ...experience,
      predicate: "identity.alias",
    });
    expect(
      attachSelfMemoryProvenance({
        selfMemories: [reservedAliasExperience],
        turn,
        assistantMessage,
        toolEvents: [successfulToolEvent],
      }),
    ).toEqual({ candidates: [], rejectedCount: 1 });
  });

  test("does not let rejected self-memory discard valid human claims", () => {
    const humanClaim = MemoryCandidateSchema.parse({
      scope: "user",
      subject: "Bob",
      predicate: "preferred drink",
      value: "tea",
      confidence: 1,
      salience: 0.8,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: [],
      sourceDiscordMessageIds: ["1000"],
    });
    const humanClaims = attachExtractionProvenance({
      candidates: [humanClaim],
      turn,
      rawRecentMessages,
    });
    const rejectedSelfMemory = attachSelfMemoryProvenance({
      selfMemories: [
        SelfMemorySchema.parse({
          kind: "accepted-alias",
          alias: "AI",
          confidence: 1,
          salience: 1,
        }),
      ],
      turn,
      assistantMessage,
      toolEvents: [],
    });

    expect(rejectedSelfMemory).toEqual({ candidates: [], rejectedCount: 1 });
    expect([...humanClaims, ...rejectedSelfMemory.candidates]).toHaveLength(1);
  });
});

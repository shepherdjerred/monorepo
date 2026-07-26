import { describe, expect, test } from "bun:test";
import {
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import type { RelationshipProposal } from "./glitter-context-refresh-generate.ts";
import { applyRelationshipProposals } from "./glitter-context-refresh-relationships.ts";
import {
  shouldEvaluateRelationships,
  shouldPersistRelationshipEvaluation,
} from "./glitter-context-refresh.ts";

const people = PeopleDocumentSchema.parse({
  schemaVersion: 1,
  people: [
    {
      id: "caitlyn",
      displayName: "Caitlyn",
      kind: "person",
      aliases: [],
      discordUserIds: ["331238905619677185"],
    },
    {
      id: "richard",
      displayName: "Richard",
      kind: "person",
      aliases: [],
      discordUserIds: ["121887985896521732"],
    },
  ],
}).people;

function evidence(messageId: string, personId: string, authorId: string) {
  return {
    personId,
    message: CurrentMessageSchema.parse({
      schemaVersion: 1,
      source: "discord-rest",
      guildId: "12345678901234567",
      guildSlug: "glitter-boys",
      channelId: "22345678901234567",
      messageId,
      author: {
        id: authorId,
        username: personId,
        globalName: personId,
        discriminator: "0",
        bot: false,
        avatar: null,
      },
      content: "explicit relationship evidence",
      timestamp: "2026-07-01T00:00:00.000Z",
      editedTimestamp: null,
      type: 0,
      flags: "0",
      pinned: false,
      tts: false,
      attachments: [],
      referencedMessageId: null,
      selectedObservationKey: `observation/${messageId}`,
      selectedObservedAt: "2026-07-01T00:00:01.000Z",
      rawSha256: "a".repeat(64),
    }),
  };
}

const relationships = RelationshipsDocumentSchema.parse({
  schemaVersion: 1,
  events: [
    {
      id: "caitlyn-richard-dating",
      sourceId: "caitlyn",
      targetId: "richard",
      kind: "romantic",
      label: "Dating",
      direction: "undirected",
      status: "current",
      effectiveAt: null,
      recordedAt: "2025-01-01T00:00:00.000Z",
      supersedesEventId: null,
      provenance: [
        {
          kind: "maintainer-assertion",
          reference: "maintainer",
          messageIds: [],
        },
      ],
    },
  ],
});

const proposal: RelationshipProposal = {
  sourceId: "caitlyn",
  targetId: "richard",
  kind: "romantic",
  label: "Exes",
  direction: "undirected",
  effectiveAt: "2026-06-01",
  evidenceMessageIds: ["60000000000000001", "60000000000000002"],
  confidence: 1,
  rationale: "Both people explicitly describe the breakup.",
};

const relationshipEvidence = [
  evidence("60000000000000001", "caitlyn", "331238905619677185"),
  evidence("60000000000000002", "richard", "121887985896521732"),
];

describe("relationship history application", () => {
  test("preserves Dating as historical and projects Exes as current", () => {
    const result = applyRelationshipProposals({
      document: relationships,
      proposals: [proposal],
      people,
      evidence: relationshipEvidence,
      snapshotSha256: "b".repeat(64),
      recordedAt: "2026-07-26T00:00:00.000Z",
    });
    expect(result.appliedCount).toBe(1);
    expect(
      result.document.events.find(
        (event) => event.id === "caitlyn-richard-dating",
      )?.status,
    ).toBe("historical");
    const current = result.document.events.filter(
      (event) => event.status === "current",
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.label).toBe("Exes");
    expect(current[0]?.supersedesEventId).toBe("caitlyn-richard-dating");
    expect(current[0]?.provenance[0]?.messageIds).toEqual([
      "60000000000000001",
      "60000000000000002",
    ]);
  });

  test("is deterministic and skips a relationship already current", () => {
    const first = applyRelationshipProposals({
      document: relationships,
      proposals: [proposal],
      people,
      evidence: relationshipEvidence,
      snapshotSha256: "b".repeat(64),
      recordedAt: "2026-07-26T00:00:00.000Z",
    });
    const second = applyRelationshipProposals({
      document: first.document,
      proposals: [proposal],
      people,
      evidence: relationshipEvidence,
      snapshotSha256: "b".repeat(64),
      recordedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(second.appliedCount).toBe(0);
    expect(second.document).toEqual(first.document);
  });
});

describe("weekly relationship evaluation", () => {
  test("evaluates every new verified snapshot independently of style eligibility", () => {
    expect(shouldEvaluateRelationships(null, "a".repeat(64))).toBe(true);
    expect(shouldEvaluateRelationships("a".repeat(64), "b".repeat(64))).toBe(
      true,
    );
    expect(shouldEvaluateRelationships("a".repeat(64), "a".repeat(64))).toBe(
      false,
    );
  });

  test("does not persist a watermark-only change", () => {
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        refreshedPeopleCount: 0,
        relationshipProposalCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        refreshedPeopleCount: 0,
        relationshipProposalCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        refreshedPeopleCount: 1,
        relationshipProposalCount: 0,
      }),
    ).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import {
  GenerationStateDocumentSchema,
  PeopleDocumentSchema,
  RelationshipsDocumentSchema,
} from "@shepherdjerred/glitter-context/schema";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";
import type { RelationshipProposal } from "./glitter-context-refresh-generate.ts";
import {
  applyRelationshipProposals,
  selectRelationshipEvidenceBatch,
} from "./glitter-context-refresh-relationships.ts";
import {
  shouldEvaluateRelationships,
  shouldPersistRelationshipEvaluation,
  updateGenerationState,
} from "./glitter-context-refresh-state.ts";

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

  test("records a reversed directed relationship as a superseding event", () => {
    const directed = RelationshipsDocumentSchema.parse({
      schemaVersion: 1,
      events: [
        {
          id: "richard-caitlyn-reports",
          sourceId: "richard",
          targetId: "caitlyn",
          kind: "professional",
          label: "Reports to",
          direction: "source-to-target",
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
    const reversed: RelationshipProposal = {
      sourceId: "caitlyn",
      targetId: "richard",
      kind: "professional",
      label: "Reports to",
      direction: "source-to-target",
      effectiveAt: "2026-06-01",
      evidenceMessageIds: ["60000000000000001", "60000000000000002"],
      confidence: 1,
      rationale: "The reporting direction flipped.",
    };
    const result = applyRelationshipProposals({
      document: directed,
      proposals: [reversed],
      people,
      evidence: relationshipEvidence,
      snapshotSha256: "b".repeat(64),
      recordedAt: "2026-07-26T00:00:00.000Z",
    });
    expect(result.appliedCount).toBe(1);
    expect(
      result.document.events.find(
        (event) => event.id === "richard-caitlyn-reports",
      )?.status,
    ).toBe("historical");
    const current = result.document.events.filter(
      (event) => event.status === "current",
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.sourceId).toBe("caitlyn");
    expect(current[0]?.targetId).toBe("richard");
    expect(current[0]?.supersedesEventId).toBe("richard-caitlyn-reports");
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

  test("requires relationship progress for a watermark-only change", () => {
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        relationshipEvaluationProgressed: false,
        refreshedPeopleCount: 0,
        relationshipProposalCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        relationshipEvaluationProgressed: false,
        refreshedPeopleCount: 0,
        relationshipProposalCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldPersistRelationshipEvaluation({
        evaluated: true,
        relationshipEvaluationProgressed: false,
        refreshedPeopleCount: 1,
        relationshipProposalCount: 0,
      }),
    ).toBe(true);
  });

  test("persists a partial cursor and only advances the watermark at completion", () => {
    const state = GenerationStateDocumentSchema.parse({
      schemaVersion: 1,
      relationshipSourceSnapshotChecksum: "a".repeat(64),
      relationshipRefreshedAt: "2026-07-01T00:00:00.000Z",
      people: [],
    });
    const partial = updateGenerationState({
      state,
      refreshedPeople: new Set(),
      candidates: [],
      snapshotSha256: "b".repeat(64),
      refreshedAt: "2026-07-02T00:00:00.000Z",
      relationshipsEvaluated: true,
      relationshipEvaluationComplete: false,
      relationshipEvaluationProgressed: true,
      relationshipEvaluationCursor: "60000000000000001",
    });
    expect(partial.relationshipSourceSnapshotChecksum).toBe("a".repeat(64));
    expect(partial.relationshipEvaluationSnapshotChecksum).toBe("b".repeat(64));
    expect(partial.relationshipEvaluationCursor).toBe("60000000000000001");

    const complete = updateGenerationState({
      state: partial,
      refreshedPeople: new Set(),
      candidates: [],
      snapshotSha256: "b".repeat(64),
      refreshedAt: "2026-07-03T00:00:00.000Z",
      relationshipsEvaluated: true,
      relationshipEvaluationComplete: true,
      relationshipEvaluationProgressed: true,
      relationshipEvaluationCursor: "60000000000000002",
    });
    expect(complete.relationshipSourceSnapshotChecksum).toBe("b".repeat(64));
    expect(complete.relationshipEvaluationSnapshotChecksum).toBeNull();
    expect(complete.relationshipEvaluationCursor).toBeNull();
  });

  test("continues a partial snapshot from the persisted cursor", () => {
    const first = relationshipEvidence[0];
    if (first === undefined) {
      throw new Error("expected relationship evidence");
    }
    const result = selectRelationshipEvidenceBatch({
      people,
      messages: relationshipEvidence.map((entry) => entry.message),
      snapshotSha256: "b".repeat(64),
      evaluationSnapshotChecksum: "b".repeat(64),
      evaluationCursor: first.message.messageId,
    });
    expect(result.evidence.map((entry) => entry.message.messageId)).toEqual([
      "60000000000000002",
    ]);
    expect(result.complete).toBe(false);
  });

  test("continues a partial cursor when a newer snapshot arrives", () => {
    const result = selectRelationshipEvidenceBatch({
      people,
      messages: relationshipEvidence.map((entry) => entry.message),
      snapshotSha256: "b".repeat(64),
      evaluationSnapshotChecksum: "a".repeat(64),
      evaluationCursor: relationshipEvidence[0]?.message.messageId ?? null,
    });
    expect(result.evidence.map((entry) => entry.message.messageId)).toEqual([
      "60000000000000002",
    ]);
    expect(result.complete).toBe(false);
  });
});

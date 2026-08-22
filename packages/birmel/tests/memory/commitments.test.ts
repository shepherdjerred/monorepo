import { describe, expect, test } from "vitest";
import { MemoryCandidateSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { buildGroundedCommitment } from "@shepherdjerred/birmel/memory/commitments.ts";
import { buildMemoryClaimFamilyKey } from "@shepherdjerred/birmel/memory/identity.ts";

const baseEvidence = {
  scope: "user" as const,
  targetUserId: "30",
  currentUserId: "30",
  currentUserMessage: "Please remember both promises.",
};

function familyKey(fields: {
  subject: string;
  predicate: string;
  value: string;
}): string {
  return buildMemoryClaimFamilyKey({
    context: {
      guildId: "10",
      channelId: "20",
      userId: "30",
      personaId: "virmel",
      authorUserId: "60",
      extractorModel: "memory-test",
    },
    candidate: MemoryCandidateSchema.parse({
      scope: "user",
      ...fields,
      confidence: 1,
      salience: 1,
      origin: "explicit",
      validFrom: null,
      validUntil: null,
      relatedUserIds: ["30"],
      sourceDiscordMessageIds: ["3000", "4000"],
    }),
  });
}

describe("grounded commitment identity", () => {
  test("keeps unrelated promises separate and groups updates by grounded topic", () => {
    const original = buildGroundedCommitment({
      ...baseEvidence,
      assistantMessage: "I will check on you tomorrow.",
      commitment: "I will check on you tomorrow.",
      topic: "check on you",
    });
    const updated = buildGroundedCommitment({
      ...baseEvidence,
      assistantMessage: "I will check on you every Friday.",
      commitment: "I will check on you every Friday.",
      topic: "check on you",
    });
    const unrelated = buildGroundedCommitment({
      ...baseEvidence,
      assistantMessage: "I will remember your birthday.",
      commitment: "I will remember your birthday.",
      topic: "your birthday",
    });

    expect(familyKey(original)).toBe(familyKey(updated));
    expect(familyKey(unrelated)).not.toBe(familyKey(original));
  });

  test("rejects a topic that is not present in the commitment", () => {
    expect(() =>
      buildGroundedCommitment({
        ...baseEvidence,
        assistantMessage: "I will check on you tomorrow.",
        commitment: "I will check on you tomorrow.",
        topic: "your birthday",
      }),
    ).toThrow("topic must be a stable excerpt");
  });
});

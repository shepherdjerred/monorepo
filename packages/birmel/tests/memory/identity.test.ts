import { describe, expect, test } from "bun:test";
import {
  buildMemoryClaimFamilyKey,
  buildMemoryClaimIdentityKey,
} from "@shepherdjerred/birmel/memory/identity.ts";

const context = {
  guildId: "100",
  channelId: "200",
  userId: "300",
  personaId: "captain-glitter",
  authorUserId: "300",
  extractorModel: "extractor-test",
};

function candidate(overrides: Record<string, unknown> = {}): unknown {
  return {
    scope: "relationship",
    subject: "Jerred and Alice",
    predicate: "relationship",
    value: "close friends",
    confidence: 0.8,
    salience: 0.7,
    origin: "inferred",
    validFrom: null,
    validUntil: null,
    relatedUserIds: ["500", "400"],
    sourceDiscordMessageIds: ["600"],
    ...overrides,
  };
}

describe("memory claim identity", () => {
  test("normalizes text, whitespace, and relationship user ordering", () => {
    const left = buildMemoryClaimIdentityKey({
      context,
      candidate: candidate(),
    });
    const right = buildMemoryClaimIdentityKey({
      context,
      candidate: candidate({
        subject: "  JERRED   and Alice ",
        predicate: "RELATIONSHIP",
        value: "Close Friends",
        relatedUserIds: ["400", "500", "400"],
      }),
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^memory-claim:v1:[a-f\d]{64}$/);
  });

  test("changes identity for a different value, scope, or validity", () => {
    const baseline = buildMemoryClaimIdentityKey({
      context,
      candidate: candidate(),
    });
    const changedValue = buildMemoryClaimIdentityKey({
      context,
      candidate: candidate({ value: "coworkers" }),
    });
    const changedValidity = buildMemoryClaimIdentityKey({
      context,
      candidate: candidate({ validFrom: "2026-01-01T00:00:00.000Z" }),
    });
    const changedGuild = buildMemoryClaimIdentityKey({
      context: { ...context, guildId: "101" },
      candidate: candidate(),
    });

    expect(
      new Set([baseline, changedValue, changedValidity, changedGuild]),
    ).toHaveLength(4);
  });

  test("keeps contradictory values in one deterministic family", () => {
    const left = buildMemoryClaimFamilyKey({
      context,
      candidate: candidate({ value: "friends" }),
    });
    const right = buildMemoryClaimFamilyKey({
      context,
      candidate: candidate({ value: "coworkers" }),
    });

    expect(left).toBe(right);
  });

  test("rejects relationship claims without two users", () => {
    expect(() =>
      buildMemoryClaimIdentityKey({
        context,
        candidate: candidate({ relatedUserIds: ["400"] }),
      }),
    ).toThrow("at least two related users");
  });
});

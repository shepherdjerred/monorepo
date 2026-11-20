import { describe, expect, it } from "vitest";
import {
  computePriority,
  isVoteBoostedPriority,
  midpoint,
  parseIdentifier,
  resolveIssuePriority,
  searchTokens,
  transitionTimestamps,
} from "./issue.ts";
import { ActorSchema } from "#shared/actor.ts";
import { avatarSvg } from "#shared/avatar.ts";

describe("issue invariants", () => {
  it("accepts search identifiers without admitting zero or unsafe numbers", () => {
    expect(parseIdentifier("ai 186")).toEqual({ teamKey: "AI", number: 186 });
    for (const value of ["AI-0", "AI--1", "AI-9007199254740992", "AI-12abc"])
      expect(() => parseIdentifier(value)).toThrow();
  });
  it("clears terminal timestamps when an issue reopens", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    const previous = { startedAt: now, completedAt: now, canceledAt: null };
    expect(transitionTimestamps("started", previous, now)).toEqual({
      startedAt: now,
      completedAt: null,
      canceledAt: null,
    });
    expect(transitionTimestamps("backlog", previous, now)).toEqual({
      startedAt: null,
      completedAt: null,
      canceledAt: null,
    });
  });
  it("requests rebalance before floating point gaps disappear", () => {
    expect(midpoint(1024, 2048)).toBe(1536);
    expect(midpoint(1, 1.00000001)).toBeNull();
    expect(() => midpoint(2, 1)).toThrow();
  });
  it("tokenizes tsquery syntax as text", () => {
    expect(searchTokens("worker's | (retry):* ! café")).toBe(
      "worker:* & s:* & retry:* & café:*",
    );
    expect(searchTokens("!|:")).toBe("");
  });
  it("requires a stable namespaced identity and rejects unknown metadata", () => {
    expect(
      ActorSchema.safeParse({
        key: "codex:thread-123",
        kind: "agent",
        name: "Codex",
        metadata: { sessionId: "thread-123" },
      }).success,
    ).toBe(true);
    expect(
      ActorSchema.safeParse({
        key: "unknown session",
        kind: "agent",
        name: "Agent",
      }).success,
    ).toBe(false);
    expect(
      ActorSchema.safeParse({
        key: "human:jerred",
        kind: "human",
        name: "Jerred",
        metadata: { secret: "invalid" },
      }).success,
    ).toBe(false);
  });
  it("generates stable inert avatars for arbitrary actor keys", () => {
    expect(avatarSvg("human:jerred")).toBe(avatarSvg("human:jerred"));
    expect(avatarSvg("human:jerred")).not.toBe(avatarSvg("codex:one"));
    expect(avatarSvg("<script>alert(1)</script>")).not.toContain("script");
  });
  it("computes priority from impact, urgency, and progressive vote boosts with manual override", () => {
    // Untriaged issues stay at 0 below 3 votes, then self-escalate at 3 / 8 / 20 votes.
    expect(computePriority({ impact: null, urgency: null, voteCount: 2 })).toBe(
      0,
    );
    expect(computePriority({ impact: null, urgency: null, voteCount: 3 })).toBe(
      3,
    );
    expect(computePriority({ impact: null, urgency: null, voteCount: 8 })).toBe(
      2,
    );
    expect(
      computePriority({ impact: null, urgency: null, voteCount: 20 }),
    ).toBe(1);
    expect(
      isVoteBoostedPriority({ impact: null, urgency: null, voteCount: 2 }),
    ).toBe(false);
    expect(
      isVoteBoostedPriority({ impact: null, urgency: null, voteCount: 3 }),
    ).toBe(true);

    // Base matrix without votes
    expect(
      computePriority({ impact: "high", urgency: "high", voteCount: 0 }),
    ).toBe(1);
    expect(
      computePriority({ impact: "high", urgency: "medium", voteCount: 0 }),
    ).toBe(2);
    expect(
      computePriority({ impact: "medium", urgency: "high", voteCount: 0 }),
    ).toBe(2);
    expect(
      computePriority({ impact: "medium", urgency: "medium", voteCount: 0 }),
    ).toBe(3);
    expect(
      computePriority({ impact: "high", urgency: "low", voteCount: 0 }),
    ).toBe(3);
    expect(
      computePriority({ impact: "low", urgency: "high", voteCount: 0 }),
    ).toBe(3);
    expect(
      computePriority({ impact: "medium", urgency: "low", voteCount: 0 }),
    ).toBe(4);
    expect(
      computePriority({ impact: "low", urgency: "low", voteCount: 0 }),
    ).toBe(4);
    expect(
      computePriority({ impact: "high", urgency: null, voteCount: 0 }),
    ).toBe(2);

    // Progressive vote boosts on sized issues: +1 tier at 3+, +2 at 8+, +3 at 20+
    expect(
      computePriority({ impact: "low", urgency: "low", voteCount: 2 }),
    ).toBe(4);
    expect(
      computePriority({ impact: "low", urgency: "low", voteCount: 3 }),
    ).toBe(3);
    expect(
      computePriority({ impact: "low", urgency: "low", voteCount: 8 }),
    ).toBe(2);
    expect(
      computePriority({ impact: "low", urgency: "low", voteCount: 20 }),
    ).toBe(1);
    expect(
      computePriority({ impact: "medium", urgency: "medium", voteCount: 3 }),
    ).toBe(2);
    expect(
      computePriority({ impact: "medium", urgency: "medium", voteCount: 8 }),
    ).toBe(1);
    expect(
      computePriority({ impact: "high", urgency: "medium", voteCount: 3 }),
    ).toBe(1);
    expect(
      isVoteBoostedPriority({ impact: "high", urgency: "high", voteCount: 10 }),
    ).toBe(false);
    expect(
      isVoteBoostedPriority({
        impact: "medium",
        urgency: "medium",
        voteCount: 4,
      }),
    ).toBe(true);

    const base: {
      priority: number;
      priorityManual: boolean;
      impact: "high" | "medium" | "low" | null;
      urgency: "high" | "medium" | "low" | null;
      voteCount: number;
    } = {
      priority: 0,
      priorityManual: false,
      impact: null,
      urgency: null,
      voteCount: 0,
    };
    // Auto calculation when impact/urgency are set without explicit priority
    const auto = resolveIssuePriority(base, { impact: "high", urgency: "low" });
    expect(auto).toEqual({ priority: 3, priorityManual: false });

    // Explicit priority pins priorityManual = true
    const pinned = resolveIssuePriority(
      { ...base, ...auto, impact: "high", urgency: "low" },
      { priority: 1 },
    );
    expect(pinned).toEqual({ priority: 1, priorityManual: true });

    // Changing urgency while pinned preserves manual priority
    const stillPinned = resolveIssuePriority(
      { ...base, ...pinned, impact: "high", urgency: "low" },
      { urgency: "medium", voteCount: 10 },
    );
    expect(stillPinned).toEqual({ priority: 1, priorityManual: true });

    // Resetting priorityManual: false snaps back to computed value (2 base - 2 boost = 1)
    const unpinned = resolveIssuePriority(
      {
        ...base,
        ...stillPinned,
        impact: "high",
        urgency: "medium",
        voteCount: 10,
      },
      { priorityManual: false },
    );
    expect(unpinned).toEqual({ priority: 1, priorityManual: false });

    // Explicitly clearing priority to 0 on a vote-escalated untriaged issue pins manual 0
    const pinnedZeroOnVoted = resolveIssuePriority(
      { ...base, priority: 3, voteCount: 5 },
      { priority: 0 },
    );
    expect(pinnedZeroOnVoted).toEqual({ priority: 0, priorityManual: true });
  });
});

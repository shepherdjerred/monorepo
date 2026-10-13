import { describe, expect, it } from "vitest";
import {
  midpoint,
  parseIdentifier,
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
});

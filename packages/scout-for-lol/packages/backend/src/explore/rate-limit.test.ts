import { beforeEach, describe, expect, test } from "bun:test";
import type { DiscordAccountId } from "@scout-for-lol/data";
import { testAccountId } from "#src/testing/test-ids.ts";
import {
  getExploreQuotaStatus,
  resetExploreRateLimitStateForTests,
  tryStartExploreTurn,
} from "#src/explore/rate-limit.ts";

const userId = testAccountId("1");
const otherUserId = testAccountId("2");
const now = Date.UTC(2026, 4, 17, 12, 0, 0);
const MINUTE_MS = 60 * 1000;

beforeEach(() => {
  resetExploreRateLimitStateForTests();
});

/** Reserve, charge, and release — what a turn that actually ran does. */
function completeTurn(id: DiscordAccountId, at: number): void {
  const ticket = tryStartExploreTurn({ userId: id }, at);
  if (!ticket.allowed) {
    throw new Error(`expected an allowed turn: ${ticket.reason}`);
  }
  ticket.commit();
  ticket.finish();
}

/** Remaining questions in the per-minute user bucket. */
function minuteRemaining(id: DiscordAccountId, at: number): number {
  const snapshot = getExploreQuotaStatus({ userId: id }, at).quota.find(
    (entry) => entry.scope === "user" && entry.window === "minute",
  );
  if (snapshot === undefined) {
    throw new Error("expected a per-minute user quota snapshot");
  }
  return snapshot.remaining;
}

describe("explore rate limit", () => {
  test("a turn in flight blocks a second concurrent turn for the same user", () => {
    const first = tryStartExploreTurn({ userId }, now);
    if (!first.allowed) {
      throw new Error("expected the first turn to be allowed");
    }

    const second = tryStartExploreTurn({ userId }, now);
    expect(second.allowed).toBe(false);
    expect(getExploreQuotaStatus({ userId }, now).activeRun).toBe(true);

    first.finish();
    expect(getExploreQuotaStatus({ userId }, now).activeRun).toBe(false);
  });

  test("the per-minute allowance is enforced and then resets", () => {
    for (let index = 0; index < 4; index++) {
      completeTurn(userId, now);
    }

    const limited = tryStartExploreTurn({ userId }, now);
    expect(limited.allowed).toBe(false);
    if (limited.allowed) {
      throw new Error("expected a rejection");
    }
    expect(limited.reason).toContain("4 of 4 questions");
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);

    // A fixed window starts at its first request, so it clears a minute later.
    const afterWindow = now + MINUTE_MS + 1;
    const allowed = tryStartExploreTurn({ userId }, afterWindow);
    expect(allowed.allowed).toBe(true);
  });

  test("quotas are charged per user, not shared between people", () => {
    for (let index = 0; index < 4; index++) {
      completeTurn(userId, now);
    }
    expect(tryStartExploreTurn({ userId }, now).allowed).toBe(false);

    const other = tryStartExploreTurn({ userId: otherUserId }, now);
    expect(other.allowed).toBe(true);
  });

  test("finish is idempotent so a double release cannot free a slot twice", () => {
    const ticket = tryStartExploreTurn({ userId }, now);
    if (!ticket.allowed) {
      throw new Error("expected an allowed turn");
    }
    ticket.finish();
    ticket.finish();

    // Still only one slot was ever taken: a fresh turn is allowed, and the
    // user has no run in flight.
    expect(getExploreQuotaStatus({ userId }, now).activeRun).toBe(false);
    expect(tryStartExploreTurn({ userId }, now).allowed).toBe(true);
  });

  /**
   * The reserve/commit split exists for this: a request is charged only once
   * it is known to be a real turn. Otherwise anyone allowlisted could drain
   * the shared global allowance with requests naming conversations that do not
   * exist, and lock everyone else out.
   */
  test("a reserved turn that never commits costs no quota", () => {
    const before = minuteRemaining(userId, now);

    const ticket = tryStartExploreTurn({ userId }, now);
    if (!ticket.allowed) {
      throw new Error("expected an allowed turn");
    }
    // The route's 400/404 path: release the slot, having charged nothing.
    ticket.finish();

    expect(minuteRemaining(userId, now)).toBe(before);
    expect(getExploreQuotaStatus({ userId }, now).activeRun).toBe(false);
  });

  test("a committed turn does spend its quota", () => {
    // The other half of the contract — without this, forgetting to commit
    // would read as "unlimited free turns" rather than as a bug.
    const before = minuteRemaining(userId, now);

    const ticket = tryStartExploreTurn({ userId }, now);
    if (!ticket.allowed) {
      throw new Error("expected an allowed turn");
    }
    ticket.commit();
    ticket.finish();

    expect(minuteRemaining(userId, now)).toBe(before - 1);
  });

  test("commit is idempotent so a turn cannot be charged twice", () => {
    const before = minuteRemaining(userId, now);

    const ticket = tryStartExploreTurn({ userId }, now);
    if (!ticket.allowed) {
      throw new Error("expected an allowed turn");
    }
    ticket.commit();
    ticket.commit();
    ticket.finish();

    expect(minuteRemaining(userId, now)).toBe(before - 1);
  });

  test("a rejected turn reports the quota it hit", () => {
    for (let index = 0; index < 4; index++) {
      completeTurn(userId, now);
    }
    const limited = tryStartExploreTurn({ userId }, now);
    if (limited.allowed) {
      throw new Error("expected a rejection");
    }
    const minute = limited.quota.find(
      (snapshot) => snapshot.scope === "user" && snapshot.window === "minute",
    );
    expect(minute?.remaining).toBe(0);
    expect(minute?.used).toBe(4);
  });
});

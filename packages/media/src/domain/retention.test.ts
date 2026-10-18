import { describe, expect, it } from "vitest";
import {
  canPurge,
  DAY_MS,
  evaluateRetention,
  extendKeep,
  RETENTION_DEFAULTS,
} from "./retention.ts";
import type { RetentionInput, RetentionRequester } from "./retention.ts";

const now = 50 * DAY_MS;
const requester: RetentionRequester = {
  userId: "viewer",
  owner: false,
  watched: true,
  observedAt: now,
  warningAcceptedAt: now - 7 * DAY_MS,
  warningFailed: false,
  fulfillment: { status: "not_applicable", reason: null },
};
const input: RetentionInput = {
  now,
  generation: 1,
  decisionGeneration: 1,
  owned: true,
  identityConfirmed: true,
  activePlayback: false,
  operationInProgress: false,
  requesters: [requester],
  holds: [],
};

describe("watched retention", () => {
  it.each([false, true])(
    "protects pending movie demand before owner filtering (owner=%s)",
    (owner) => {
      expect(
        evaluateRetention({
          ...input,
          requesters: [
            requester,
            {
              ...requester,
              userId: "pending",
              owner,
              fulfillment: {
                status: "pending_choice",
                reason: "movie_edition_choice_required",
              },
            },
          ],
        }),
      ).toEqual({
        state: "protected",
        reason: "movie_edition_choice_required",
      });
    },
  );
  it("protects owner-only and unclaimed media instead of using vacuous every", () => {
    expect(evaluateRetention({ ...input, requesters: [] })).toEqual({
      state: "protected",
      reason: "owner_only_or_unclaimed",
    });
    expect(
      evaluateRetention({
        ...input,
        requesters: [{ ...requester, owner: true, watched: false }],
      }).state,
    ).toBe("protected");
  });
  it("excludes the owner's watch status but requires every other requester", () => {
    expect(
      evaluateRetention({
        ...input,
        requesters: [
          requester,
          { ...requester, userId: "owner", owner: true, watched: false },
        ],
      }).state,
    ).toBe("quarantine_eligible");
    expect(
      evaluateRetention({
        ...input,
        requesters: [
          requester,
          { ...requester, userId: "other", watched: false },
        ],
      }),
    ).toEqual({ state: "protected", reason: "requester_unwatched" });
  });
  it("holds uncertain and stale watch evidence", () => {
    expect(
      evaluateRetention({
        ...input,
        requesters: [{ ...requester, watched: null }],
      }).state,
    ).toBe("protected");
    expect(
      evaluateRetention({
        ...input,
        requesters: [
          {
            ...requester,
            observedAt: now - RETENTION_DEFAULTS.maximumWatchAgeMs - 1,
          },
        ],
      }),
    ).toEqual({ state: "protected", reason: "watch_stale" });
  });
  it("starts grace after the last accepted personal warning", () => {
    const result = evaluateRetention({
      ...input,
      requesters: [
        requester,
        { ...requester, userId: "other", warningAcceptedAt: now - DAY_MS },
      ],
    });
    expect(result).toEqual({
      state: "grace_period",
      graceUntil: now + 6 * DAY_MS,
    });
  });
  it("holds failed warning delivery and rejects obsolete decisions", () => {
    expect(
      evaluateRetention({
        ...input,
        requesters: [{ ...requester, warningFailed: true }],
      }),
    ).toEqual({ state: "warning_pending", recipients: ["viewer"] });
    expect(evaluateRetention({ ...input, generation: 2 })).toEqual({
      state: "protected",
      reason: "decision_obsolete",
    });
  });
  it("prevents removal during playback, publication, or a Keep hold", () => {
    expect(evaluateRetention({ ...input, activePlayback: true }).state).toBe(
      "protected",
    );
    expect(
      evaluateRetention({ ...input, operationInProgress: true }).state,
    ).toBe("protected");
    expect(
      evaluateRetention({
        ...input,
        holds: [{ until: now + DAY_MS, isPin: false }],
      }).state,
    ).toBe("protected");
    expect(
      evaluateRetention({ ...input, holds: [{ until: null, isPin: true }] })
        .state,
    ).toBe("protected");
  });
  it("extends Keep without shortening an existing extension", () => {
    expect(extendKeep(now, null)).toBe(now + 30 * DAY_MS);
    expect(extendKeep(now, now + 40 * DAY_MS)).toBe(now + 40 * DAY_MS);
  });
  it("requires fresh ownership and generation checks at purge", () => {
    const purge = {
      now,
      quarantinedAt: now - 7 * DAY_MS,
      generation: 1,
      decisionGeneration: 1,
      owned: true,
      manifestVerified: true,
      protectedByRequestOrHold: false,
      activeOperation: false,
    };
    expect(canPurge(purge)).toBe(true);
    expect(canPurge({ ...purge, generation: 2 })).toBe(false);
    expect(canPurge({ ...purge, protectedByRequestOrHold: true })).toBe(false);
    expect(canPurge({ ...purge, quarantinedAt: now - 6 * DAY_MS })).toBe(false);
  });
});

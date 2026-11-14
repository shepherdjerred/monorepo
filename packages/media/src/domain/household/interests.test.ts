import { describe, expect, it } from "vitest";
import {
  evaluateRequestInterest,
  INTEREST_POLICY,
  type InterestFacts,
} from "./interests.ts";

const day = 86_400_000;
const now = 100 * day;
const base: InterestFacts = {
  now,
  kind: "movie",
  policy: "temporary",
  state: "following",
  revision: 3,
  renewedAt: 0,
  usableUnwatchedSince: day,
  lastProgressAt: null,
  usableUnwatched: true,
  watchedComplete: false,
  requestedCoverageComplete: true,
  terminalStatus: "unknown",
  terminalObservedAt: null,
  notice: null,
};
describe("temporary household interest", () => {
  it("keeps explicitly permanent media regardless of watched status", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        policy: "keep",
        watchedComplete: true,
      }),
    ).toMatchObject({ state: "protected", reason: "keep_indefinitely" });
  });
  it("finishes a watched temporary movie automatically", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        watchedComplete: true,
        usableUnwatched: false,
      }),
    ).toEqual({ state: "release", stateAfter: "finished", reason: "watched" });
  });
  it("protects a caught-up continuing show", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        kind: "series",
        watchedComplete: true,
        terminalStatus: "continuing",
        terminalObservedAt: now,
      }),
    ).toMatchObject({ state: "protected", reason: "caught_up_following" });
  });
  it.each(["ended", "cancelled"] as const)(
    "finishes complete %s series",
    (terminalStatus) => {
      expect(
        evaluateRequestInterest({
          ...base,
          kind: "series",
          watchedComplete: true,
          terminalStatus,
          terminalObservedAt: now,
        }),
      ).toMatchObject({ state: "release", reason: "series_finished" });
    },
  );
  it.each([null, now - 2 * day, now + 1])(
    "protects an uncertain/stale/future terminal observation %s",
    (terminalObservedAt) => {
      expect(
        evaluateRequestInterest({
          ...base,
          kind: "series",
          watchedComplete: true,
          terminalStatus: "ended",
          terminalObservedAt,
        }),
      ).toMatchObject({ state: "protected" });
    },
  );
  it("does not complete known requested unaired or missing coverage", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        kind: "series",
        watchedComplete: true,
        requestedCoverageComplete: false,
        usableUnwatched: false,
        terminalStatus: "ended",
        terminalObservedAt: now,
      }),
    ).toMatchObject({
      state: "protected",
      reason: "no_usable_unwatched_content",
    });
  });
  it.each([false, null])(
    "does not age while content is unavailable or uncertain (%s)",
    (usableUnwatched) => {
      expect(
        evaluateRequestInterest({ ...base, usableUnwatched }),
      ).toMatchObject({ state: "protected", resetUsableClock: true });
    },
  );
  it("waits 30 days for a never-started request", () => {
    expect(evaluateRequestInterest({ ...base, now: 30 * day })).toMatchObject({
      state: "following",
    });
    expect(evaluateRequestInterest({ ...base, now: 31 * day })).toMatchObject({
      state: "notice_pending",
    });
  });
  it("waits 60 days after genuine progress", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        now: 70 * day,
        lastProgressAt: 11 * day,
      }),
    ).toMatchObject({ state: "following" });
    expect(
      evaluateRequestInterest({
        ...base,
        now: 71 * day,
        lastProgressAt: 11 * day,
      }),
    ).toMatchObject({ state: "notice_pending" });
  });
  it("never expires without verified private notice acceptance", () => {
    for (const notice of [
      null,
      { revision: 3, acceptedAt: null, failed: false },
      { revision: 3, acceptedAt: 40 * day, failed: true },
      { revision: 2, acceptedAt: 40 * day, failed: false },
    ])
      expect(evaluateRequestInterest({ ...base, notice })).toMatchObject({
        state: "notice_pending",
      });
  });
  it("provides seven full days after the accepted check-in", () => {
    const notice = { revision: 3, acceptedAt: 94 * day, failed: false };
    expect(evaluateRequestInterest({ ...base, notice })).toMatchObject({
      state: "reply_pending",
      replyBy: 101 * day,
    });
    expect(
      evaluateRequestInterest({ ...base, now: 101 * day, notice }),
    ).toMatchObject({
      state: "release",
      stateAfter: "expired",
      reason: "lost_interest",
    });
  });
  it("renewing interest invalidates an old acceptance", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        renewedAt: 90 * day,
        revision: 4,
        notice: { revision: 3, acceptedAt: 40 * day, failed: false },
      }),
    ).toMatchObject({ state: "following" });
  });
  it("rejects a notice accepted before inactivity eligibility", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        notice: { revision: 3, acceptedAt: day, failed: false },
      }),
    ).toMatchObject({ state: "protected", reason: "interest_notice_invalid" });
  });
  it("does not release a released request twice", () => {
    expect(
      evaluateRequestInterest({
        ...base,
        state: "finished",
        watchedComplete: true,
      }),
    ).toMatchObject({
      state: "protected",
      reason: "interest_already_released",
    });
  });
  it("keeps the seven-day reply policy independent of removal quarantine", () => {
    expect(INTEREST_POLICY.replyMs).toBe(7 * day);
  });
});

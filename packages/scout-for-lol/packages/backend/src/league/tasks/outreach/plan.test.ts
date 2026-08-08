/**
 * The outreach ladder decision.
 *
 * `planOutreach` is pure so the rules that decide whether a real person gets a
 * DM can be tested exhaustively without Discord or a clock. Each case below
 * corresponds to a behaviour that was wrong in the version this replaces.
 */

import { describe, it, expect } from "bun:test";
import { planOutreach } from "#src/league/tasks/outreach/index.ts";

const INSTALLED = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(INSTALLED.getTime() + n * 86_400_000);

function plan(overrides: Partial<Parameters<typeof planOutreach>[0]> = {}) {
  return planOutreach({
    serverName: "Test Server",
    installedAt: INSTALLED,
    outreachStage: 0,
    feedbackRequestedAt: null,
    state: { subscriptions: 0, competitions: 0 },
    now: day(3),
    ...overrides,
  });
}

describe("planOutreach — timing", () => {
  it("sends nothing before day 3", () => {
    expect(plan({ now: day(2) })).toMatchObject({
      action: "skip",
      reason: "too_soon",
    });
  });

  it("sends the first nudge at day 3 when nothing is configured", () => {
    expect(plan({ now: day(3) })).toMatchObject({
      action: "send",
      stage: 1,
      kind: "outreach_nudge",
    });
  });

  it("holds stage 2 until day 14", () => {
    expect(plan({ outreachStage: 1, now: day(13) })).toMatchObject({
      action: "skip",
      reason: "too_soon",
    });
    expect(plan({ outreachStage: 1, now: day(14) })).toMatchObject({
      action: "send",
      stage: 2,
    });
  });

  it("holds stage 3 until day 30", () => {
    expect(plan({ outreachStage: 2, now: day(29) })).toMatchObject({
      action: "skip",
      reason: "too_soon",
    });
    expect(plan({ outreachStage: 2, now: day(30) })).toMatchObject({
      action: "send",
      stage: 3,
    });
  });
});

describe("planOutreach — budget", () => {
  it("never plans a fourth message", () => {
    expect(plan({ outreachStage: 3, now: day(365) })).toMatchObject({
      action: "skip",
      reason: "budget_exhausted",
    });
  });

  it("stays exhausted no matter how much time passes", () => {
    for (const days of [30, 90, 365, 3650]) {
      expect(plan({ outreachStage: 3, now: day(days) })).toMatchObject({
        action: "skip",
        reason: "budget_exhausted",
      });
    }
  });
});

describe("planOutreach — content adapts to actual state", () => {
  it("does not spend a message nudging an already-configured guild", () => {
    // The budget is for messages worth sending; a configured server has
    // nothing to be nudged about.
    expect(
      plan({ state: { subscriptions: 2, competitions: 0 }, now: day(3) }),
    ).toMatchObject({ action: "skip", reason: "configured" });
  });

  it("asks a configured guild for feedback at stage 2", () => {
    expect(
      plan({
        outreachStage: 1,
        state: { subscriptions: 1, competitions: 0 },
        now: day(14),
      }),
    ).toMatchObject({ action: "send", stage: 2, kind: "feedback_request" });
  });

  it("asks for feedback at one subscription, not three", () => {
    // The old three-subscription gate excluded most real users, which is why
    // only four feedback DMs were ever attempted.
    const result = plan({
      outreachStage: 1,
      state: { subscriptions: 1, competitions: 0 },
      now: day(14),
    });
    expect(result).toMatchObject({ kind: "feedback_request" });
  });

  it("treats an active competition as configured even with no subscriptions", () => {
    expect(
      plan({
        outreachStage: 1,
        state: { subscriptions: 0, competitions: 1 },
        now: day(14),
      }),
    ).toMatchObject({ kind: "feedback_request" });
  });

  it("nudges again at stage 2 when still unconfigured", () => {
    expect(plan({ outreachStage: 1, now: day(14) })).toMatchObject({
      action: "send",
      stage: 2,
      kind: "outreach_nudge",
    });
  });

  it("sends a final last-call at stage 3 when still unconfigured", () => {
    const result = plan({ outreachStage: 2, now: day(30) });
    expect(result).toMatchObject({
      action: "send",
      stage: 3,
      kind: "outreach_last_call",
    });
    if (result.action !== "send") throw new Error("expected a send");
    expect(result.message).toContain("remove it any time");
  });

  it("never asks for feedback twice", () => {
    expect(
      plan({
        outreachStage: 2,
        feedbackRequestedAt: day(14),
        state: { subscriptions: 5, competitions: 0 },
        now: day(30),
      }),
    ).toMatchObject({ action: "skip", reason: "already_asked" });
  });
});

describe("planOutreach — late configuration", () => {
  it("still asks a guild that configures long after install", () => {
    // The old one-shot marking burned 33 of 37 guilds out of the feedback ask
    // because their state at a single instant decided their fate forever.
    expect(
      plan({
        outreachStage: 1,
        state: { subscriptions: 4, competitions: 1 },
        now: day(200),
      }),
    ).toMatchObject({ action: "send", kind: "feedback_request" });
  });

  it("advances a guild through the whole ladder as its state changes", () => {
    const first = plan({ outreachStage: 0, now: day(3) });
    expect(first).toMatchObject({ kind: "outreach_nudge" });

    const second = plan({
      outreachStage: 1,
      state: { subscriptions: 2, competitions: 0 },
      now: day(14),
    });
    expect(second).toMatchObject({ kind: "feedback_request" });

    const third = plan({
      outreachStage: 2,
      feedbackRequestedAt: day(14),
      state: { subscriptions: 2, competitions: 0 },
      now: day(30),
    });
    expect(third).toMatchObject({ action: "skip", reason: "already_asked" });
  });
});

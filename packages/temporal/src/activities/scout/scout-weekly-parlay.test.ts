import { describe, expect, test } from "vitest";
import { WeeklyParlayControlActionSchema as ScoutWeeklyParlayActionSchema } from "@scout-for-lol/data/model/bucks/weekly-parlay.ts";
import {
  buildScoutWeeklyParlayCatchupTimeline,
  buildScoutWeeklyParlayTimeline,
  scoutWeeklyParlayActionKey,
} from "./scout-weekly-parlay.ts";

describe("Scout weekly parlay Pacific timeline", () => {
  test("preserves every wall-clock action through spring DST", () => {
    const timeline = buildScoutWeeklyParlayTimeline("2027-03-07T20:00:00.000Z");
    expect(timeline).toEqual({
      periodKey: "2027-03-08",
      openAt: "2027-03-07T20:00:00.000Z",
      reminderAt: "2027-03-08T03:00:00.000Z",
      startsAt: "2027-03-08T08:00:00.000Z",
      updatesAt: [
        "2027-03-09T03:00:00.000Z",
        "2027-03-10T03:00:00.000Z",
        "2027-03-11T03:00:00.000Z",
        "2027-03-12T03:00:00.000Z",
        "2027-03-13T03:00:00.000Z",
        "2027-03-14T03:00:00.000Z",
      ],
      finalizesAt: "2027-03-14T18:00:00.000Z",
    });
  });

  test("preserves every wall-clock action through fall DST", () => {
    const timeline = buildScoutWeeklyParlayTimeline("2027-10-31T19:00:00.000Z");
    expect(timeline.periodKey).toBe("2027-11-01");
    expect(timeline.openAt).toBe("2027-10-31T19:00:00.000Z");
    expect(timeline.finalizesAt).toBe("2027-11-07T19:00:00.000Z");
  });

  test("builds a stable replay callback idempotency key", () => {
    expect(
      scoutWeeklyParlayActionKey({
        periodKey: "2027-03-08",
        slot: 2,
        action: "progress",
        updateIndex: 4,
      }),
    ).toBe("scout-weekly-parlay:2027-03-08:2:progress:4");
  });

  test("opens the first catch-up scoring midnight beyond the minimum budget", () => {
    const timeline = buildScoutWeeklyParlayCatchupTimeline(
      "2026-08-24T19:00:00.000Z",
      "2026-08-24",
    );
    expect(timeline).toEqual({
      periodKey: "2026-08-24",
      openAt: "2026-08-24T19:00:00.000Z",
      reminderAt: "2026-08-25T02:00:00.000Z",
      startsAt: "2026-08-25T07:00:00.000Z",
      updatesAt: [
        "2026-08-26T02:00:00.000Z",
        "2026-08-27T02:00:00.000Z",
        "2026-08-28T02:00:00.000Z",
        "2026-08-29T02:00:00.000Z",
        "2026-08-30T02:00:00.000Z",
      ],
      finalizesAt: "2026-08-30T18:00:00.000Z",
    });
  });

  test("rolls the catch-up cutoff forward when the next midnight is too close", () => {
    const timeline = buildScoutWeeklyParlayCatchupTimeline(
      "2026-08-25T00:57:00.000Z",
      "2026-08-24",
    );
    expect(timeline.startsAt).toBe("2026-08-26T07:00:00.000Z");
    expect(timeline.reminderAt).toBe("2026-08-26T02:00:00.000Z");
    expect(timeline.updatesAt).toHaveLength(4);
  });

  test("rejects a catch-up start with no scoring window before Sunday", () => {
    expect(() =>
      buildScoutWeeklyParlayCatchupTimeline(
        "2026-08-30T01:00:00.000Z",
        "2026-08-24",
      ),
    ).toThrow("No catch-up scoring window remains");
  });

  test("allows catch-up clocks only on the open control action", () => {
    const window = {
      kind: "catch_up",
      openAt: "2026-08-24T19:00:00.000Z",
      bettingClosesAt: "2026-08-25T07:00:00.000Z",
      scoringStartsAt: "2026-08-25T07:00:00.000Z",
      scoringEndsAt: "2026-08-30T18:00:00.000Z",
    };
    expect(
      ScoutWeeklyParlayActionSchema.safeParse({
        periodKey: "2026-08-24",
        slot: 0,
        action: "open",
        window,
      }).success,
    ).toBe(true);
    expect(
      ScoutWeeklyParlayActionSchema.safeParse({
        periodKey: "2026-08-24",
        slot: 0,
        action: "finalize",
        window,
      }).success,
    ).toBe(false);
  });
});

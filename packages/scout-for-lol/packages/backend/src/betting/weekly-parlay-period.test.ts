import { describe, expect, test } from "vitest";
import {
  isWithinWeeklyScoringPeriod,
  WEEKLY_PARLAY_INGESTION_GRACE_MS,
  weeklyParlayFinalSettlementAt,
  weeklyParlayPeriod,
  weeklyParlayScoringShape,
  weeklyParlayScoringWindowForPeriod,
  weeklyParlayTimelineFromWindow,
} from "#src/betting/weekly-parlay-period.ts";

describe("weekly parlay Pacific periods", () => {
  test("uses wall time across the spring DST transition", () => {
    const period = weeklyParlayPeriod("2026-03-09");
    expect(period.openAt.toISOString()).toBe("2026-03-08T19:00:00.000Z");
    expect(period.scoringStartsAt.toISOString()).toBe(
      "2026-03-09T07:00:00.000Z",
    );
    expect(period.scoringEndsAt.toISOString()).toBe("2026-03-15T18:00:00.000Z");
    expect(period.nextOpenAt.toISOString()).toBe("2026-03-15T19:00:00.000Z");
    expect(period.updateAt).toHaveLength(6);
  });

  test("uses wall time across the fall DST transition", () => {
    const period = weeklyParlayPeriod("2026-11-02");
    expect(period.openAt.toISOString()).toBe("2026-11-01T20:00:00.000Z");
    expect(period.scoringStartsAt.toISOString()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
    expect(period.scoringEndsAt.toISOString()).toBe("2026-11-08T19:00:00.000Z");
    expect(period.nextOpenAt.getTime() - period.scoringEndsAt.getTime()).toBe(
      60 * 60 * 1000,
    );
  });

  test("enforces half-open completion boundaries", () => {
    const period = weeklyParlayPeriod("2026-08-24");
    expect(isWithinWeeklyScoringPeriod(period.scoringStartsAt, period)).toBe(
      true,
    );
    expect(
      isWithinWeeklyScoringPeriod(
        new Date(period.scoringEndsAt.getTime() - 1),
        period,
      ),
    ).toBe(true);
    expect(isWithinWeeklyScoringPeriod(period.scoringEndsAt, period)).toBe(
      false,
    );
  });

  test("reserves a bounded ingestion reconciliation window after scoring", () => {
    const period = weeklyParlayPeriod("2026-03-09");
    expect(
      weeklyParlayFinalSettlementAt(period.scoringEndsAt).getTime() -
        period.scoringEndsAt.getTime(),
    ).toBe(WEEKLY_PARLAY_INGESTION_GRACE_MS);
    expect(
      weeklyParlayFinalSettlementAt(period.scoringEndsAt).getTime(),
    ).toBeLessThan(period.nextOpenAt.getTime());
  });

  test("rejects a non-Monday period key", () => {
    expect(() => weeklyParlayPeriod("2026-08-23")).toThrow("must be a Monday");
  });

  test("derives a shortened catch-up timeline from frozen clocks", () => {
    const timeline = weeklyParlayTimelineFromWindow({
      periodKey: "2026-08-24",
      openAt: new Date("2026-08-24T19:00:00.000Z"),
      bettingClosesAt: new Date("2026-08-25T07:00:00.000Z"),
      scoringStartsAt: new Date("2026-08-25T07:00:00.000Z"),
      scoringEndsAt: new Date("2026-08-30T18:00:00.000Z"),
    });
    expect(timeline.reminderAt?.toISOString()).toBe("2026-08-25T02:00:00.000Z");
    expect(timeline.updateAt.map((instant) => instant.toISOString())).toEqual([
      "2026-08-26T02:00:00.000Z",
      "2026-08-27T02:00:00.000Z",
      "2026-08-28T02:00:00.000Z",
      "2026-08-29T02:00:00.000Z",
      "2026-08-30T02:00:00.000Z",
    ]);
  });

  test("replays the same Pacific weekday and hour shape across DST", () => {
    const shape = weeklyParlayScoringShape({
      periodKey: "2026-10-26",
      scoringStartsAt: new Date("2026-10-28T07:00:00.000Z"),
      scoringEndsAt: new Date("2026-11-01T19:00:00.000Z"),
    });
    expect(shape).toEqual({
      startDayOffset: 2,
      startHour: 0,
      endDayOffset: 6,
      endHour: 11,
    });
    const replay = weeklyParlayScoringWindowForPeriod("2027-03-08", shape);
    expect(replay.scoringStartsAt.toISOString()).toBe(
      "2027-03-10T08:00:00.000Z",
    );
    expect(replay.scoringEndsAt.toISOString()).toBe("2027-03-14T18:00:00.000Z");
  });
});

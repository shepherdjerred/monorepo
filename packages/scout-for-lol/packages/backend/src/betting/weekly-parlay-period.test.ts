import { describe, expect, test } from "vitest";
import {
  isWithinWeeklyScoringPeriod,
  WEEKLY_PARLAY_INGESTION_GRACE_MS,
  weeklyParlayFinalSettlementAt,
  weeklyParlayPeriod,
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
});

import { describe, expect, test } from "vitest";
import {
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

  test("builds stable period, slot, action, and update idempotency keys", () => {
    expect(
      scoutWeeklyParlayActionKey({
        periodKey: "2027-03-08",
        slot: 2,
        action: "progress",
        updateIndex: 4,
      }),
    ).toBe("scout-weekly-parlay:2027-03-08:2:progress:4");
  });
});

import { describe, expect, test } from "vitest";
import { recoveryStartAt } from "#src/league/tasks/postmatch/gap-recovery.ts";

describe("recoveryStartAt", () => {
  test("uses the ingestion-backed cursor timestamp for a required Dare", () => {
    const cursorTime = new Date("2026-09-01T12:00:00.000Z");
    const discoveryTime = new Date("2026-09-01T13:00:00.000Z");

    expect(
      recoveryStartAt({
        requiredForActiveDare: true,
        lastProcessedMatchTime: cursorTime,
        lastSuccessfulPollAt: discoveryTime,
        puuid: "puuid-1",
      }),
    ).toEqual(cursorTime);
  });

  test("rejects required recovery without an ingestion-backed cursor timestamp", () => {
    expect(() =>
      recoveryStartAt({
        requiredForActiveDare: true,
        lastProcessedMatchTime: undefined,
        lastSuccessfulPollAt: new Date("2026-09-01T13:00:00.000Z"),
        puuid: "puuid-1",
      }),
    ).toThrow("Cannot recover required Dare history");
  });
});

import { expect, test } from "bun:test";
import { getAllSeasons } from "@scout-for-lol/data";
import { scoutSeasonScheduleEndTimestampSeconds } from "#src/metrics/season-schedule.ts";

test("publishes the latest bundled season end timestamp", async () => {
  const latestEndTimestampSeconds = Math.max(
    ...getAllSeasons().map((season) => season.endDate.getTime() / 1000),
  );
  const metric = await scoutSeasonScheduleEndTimestampSeconds.get();

  expect(metric.values).toHaveLength(1);
  expect(metric.values[0]?.value).toBe(latestEndTimestampSeconds);
});

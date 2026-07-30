import { Gauge } from "prom-client";
import { getAllSeasons } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { registry } from "#src/metrics/registry.ts";

const logger = createLogger("season-schedule-metrics");
const latestSeasonEndTimestampSeconds = Math.max(
  ...getAllSeasons().map((season) => season.endDate.getTime() / 1000),
);

export const scoutSeasonScheduleEndTimestampSeconds = new Gauge({
  name: "scout_season_schedule_end_timestamp_seconds",
  help: "Unix timestamp when the latest bundled League of Legends season ends",
  registers: [registry],
});

scoutSeasonScheduleEndTimestampSeconds.set(latestSeasonEndTimestampSeconds);

if (latestSeasonEndTimestampSeconds <= Date.now() / 1000) {
  logger.error(
    "No current or future League of Legends season metadata is bundled; season autocomplete is unavailable until SEASONS is refreshed and promoted",
  );
}

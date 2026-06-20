import {
  RawMatchSchema,
  resolveQueueTypeFromGame,
  type QueueType,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import { competitionChartToImage } from "@scout-for-lol/report";
import {
  type ReportGraphMetric,
  type ShowcaseEntry,
} from "#src/showcase/manifest.ts";
import { readS3JsonOptional } from "#src/showcase/s3.ts";
import {
  safeFileName,
  type GenerateEntryContext,
  type GeneratedImage,
} from "#src/showcase/generate-types.ts";

function metricValue(
  participant: RawParticipant,
  metric: ReportGraphMetric,
): number {
  switch (metric) {
    case "kills":
      return participant.kills;
    case "assists":
      return participant.assists;
    case "deaths":
      return participant.deaths;
    case "kda": {
      const takedowns = participant.kills + participant.assists;
      return participant.deaths === 0
        ? takedowns
        : takedowns / participant.deaths;
    }
    case "gold":
      return participant.goldEarned;
    case "damage_to_champions":
      return participant.totalDamageDealtToChampions;
    case "damage_taken":
      return participant.totalDamageTaken;
    case "vision_score":
      return participant.visionScore;
    case "cs":
      return participant.totalMinionsKilled + participant.neutralMinionsKilled;
  }
}

function playerLabel(participant: RawParticipant): string {
  return (
    participant.riotIdGameName ??
    participant.riotIdName ??
    participant.summonerName
  );
}

function includeMatchForReportGraph(
  match: RawMatch,
  queueFilter: QueueType[] | undefined,
): boolean {
  if (queueFilter === undefined) {
    return true;
  }
  const queue = resolveQueueTypeFromGame(
    match.info.queueId,
    match.info.gameMode,
  );
  return queue === undefined ? false : queueFilter.includes(queue);
}

export async function generateReportGraph(
  entry: Extract<ShowcaseEntry, { kind: "report-graph" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  const totals = new Map<string, { value: number; games: number }>();
  for (const key of entry.matchKeys) {
    const json = await readS3JsonOptional({
      client: ctx.client,
      bucket: ctx.bucket,
      key,
    });
    if (json === undefined) {
      continue;
    }
    const match = RawMatchSchema.parse(json);
    if (!includeMatchForReportGraph(match, entry.queueFilter)) {
      continue;
    }

    for (const participant of match.info.participants) {
      const label = playerLabel(participant);
      const previous = totals.get(label) ?? { value: 0, games: 0 };
      totals.set(label, {
        value: previous.value + metricValue(participant, entry.metric),
        games: previous.games + 1,
      });
    }
  }

  const bars = [...totals.entries()]
    .map(([playerName, aggregate]) => ({
      playerName,
      value:
        entry.metric === "kda"
          ? aggregate.value / aggregate.games
          : aggregate.value,
    }))
    .toSorted((left, right) => right.value - left.value)
    .slice(0, 10);

  if (bars.length === 0) {
    throw new Error(`Report graph ${entry.id} had no matching rows`);
  }

  const bytes = await competitionChartToImage({
    chartType: "bar",
    title: entry.title,
    ...(entry.description === undefined ? {} : { subtitle: entry.description }),
    yAxisLabel: entry.yAxisLabel,
    bars,
  });
  return {
    fileName: safeFileName(entry.id, "png"),
    bytes,
    sourceKeys: entry.matchKeys,
  };
}

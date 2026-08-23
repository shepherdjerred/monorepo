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
  // championName is the last resort rather than a placeholder string: every
  // participant has one, and it still identifies the row to a reader. Riot may
  // send none of the three name fields for a custom game.
  return (
    participant.riotIdGameName ??
    participant.riotIdName ??
    participant.summonerName ??
    participant.championName
  );
}

export function includeMatchForReportGraph(
  match: RawMatch,
  queueFilter: QueueType[] | undefined,
): boolean {
  if (queueFilter === undefined) {
    return true;
  }
  const queue = resolveQueueTypeFromGame(
    match.info.queueId,
    match.info.gameMode,
    match.info.gameType,
  );
  return queue === undefined ? false : queueFilter.includes(queue);
}

export async function generateReportGraph(
  entry: Extract<ShowcaseEntry, { kind: "report-graph" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  // Keyed on puuid, not on the display name. Two players can share a display
  // name across regions, and the old name-keyed map silently summed them into
  // one bar; it also made the label load-bearing, so any pseudonym that
  // collided would have merged real people's stats.
  const totals = new Map<
    string,
    { value: number; games: number; name: string }
  >();
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
      const previous = totals.get(participant.puuid) ?? {
        value: 0,
        games: 0,
        name: playerLabel(participant),
      };
      totals.set(participant.puuid, {
        value: previous.value + metricValue(participant, entry.metric),
        games: previous.games + 1,
        name: previous.name,
      });
    }
  }

  // Anonymize AFTER the slice, not before. This graph aggregates all ten
  // participants of every match — ~120 distinct puuids across a 12-match
  // manifest — but renders only the top ten. Assigning a handle per aggregated
  // player would exhaust the pool and push the rendered bars into the numbered
  // fallback, so only players who actually appear consume one.
  const bars = [...totals.entries()]
    .map(([puuid, aggregate]) => ({
      puuid,
      realName: aggregate.name,
      value:
        entry.metric === "kda"
          ? aggregate.value / aggregate.games
          : aggregate.value,
    }))
    .toSorted((left, right) => right.value - left.value)
    .slice(0, 10)
    .map((bar) => ({
      playerName: ctx.anonymizePlayer(bar.puuid, bar.realName),
      value: bar.value,
    }));

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

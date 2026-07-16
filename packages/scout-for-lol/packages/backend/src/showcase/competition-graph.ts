import {
  CachedLeaderboardSchema,
  RankSchema,
  rankToLeaguePoints,
  type CachedLeaderboard,
} from "@scout-for-lol/data";
import {
  competitionChartToImage,
  type CompetitionChartProps,
} from "@scout-for-lol/report";
import type { ShowcaseEntry } from "#src/showcase/manifest.ts";
import { readS3Json } from "#src/showcase/s3.ts";
import {
  safeFileName,
  type GenerateEntryContext,
  type GeneratedImage,
} from "#src/showcase/generate-types.ts";

type CompetitionGraphEntry = Extract<
  ShowcaseEntry,
  { kind: "competition-graph" }
>;

function leaderboardScoreToNumber(
  score: CachedLeaderboard["entries"][number]["score"],
): number {
  const rank = RankSchema.safeParse(score);
  if (rank.success) {
    return rankToLeaguePoints(rank.data);
  }
  return Number(score);
}

function latestSnapshot(snapshots: CachedLeaderboard[]): CachedLeaderboard {
  const latest = snapshots
    .toSorted(
      (left, right) =>
        new Date(left.calculatedAt).getTime() -
        new Date(right.calculatedAt).getTime(),
    )
    .at(-1);
  if (latest === undefined) {
    throw new Error("Cannot build competition chart without snapshots");
  }
  return latest;
}

function competitionLineChartProps(params: {
  entry: CompetitionGraphEntry;
  snapshots: CachedLeaderboard[];
}): CompetitionChartProps {
  const sorted = params.snapshots.toSorted(
    (left, right) =>
      new Date(left.calculatedAt).getTime() -
      new Date(right.calculatedAt).getTime(),
  );
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("Cannot render line chart without snapshots");
  }

  // Pick the players to plot from the most-populated snapshot, not strictly
  // the latest — a leaderboard whose final snapshot emptied out would
  // otherwise yield an empty chart.
  const richestSnapshot =
    sorted.toSorted(
      (left, right) => right.entries.length - left.entries.length,
    )[0] ?? first;
  const topEntries = richestSnapshot.entries.slice(0, 10);
  return {
    chartType: "line",
    title: params.entry.title,
    ...(params.entry.description === undefined
      ? {}
      : { subtitle: params.entry.description }),
    yAxisLabel: params.entry.yAxisLabel,
    startDate: new Date(first.calculatedAt),
    endDate: new Date(last.calculatedAt),
    series: topEntries.map((entry) => ({
      playerName: entry.playerName,
      points: sorted.map((snapshot) => {
        const snapshotEntry = snapshot.entries.find(
          (candidate) => candidate.playerId === entry.playerId,
        );
        return {
          date: new Date(snapshot.calculatedAt),
          value:
            snapshotEntry === undefined
              ? null
              : leaderboardScoreToNumber(snapshotEntry.score),
        };
      }),
    })),
  };
}

function competitionBarChartProps(params: {
  entry: CompetitionGraphEntry;
  snapshots: CachedLeaderboard[];
}): CompetitionChartProps {
  const latest = latestSnapshot(params.snapshots);
  return {
    chartType: "bar",
    title: params.entry.title,
    ...(params.entry.description === undefined
      ? {}
      : { subtitle: params.entry.description }),
    yAxisLabel: params.entry.yAxisLabel,
    bars: latest.entries.slice(0, 10).map((entry) => ({
      playerName: entry.playerName,
      value: leaderboardScoreToNumber(entry.score),
    })),
  };
}

export async function generateCompetitionGraph(
  entry: CompetitionGraphEntry,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  const snapshots: CachedLeaderboard[] = [];
  for (const key of entry.snapshotKeys) {
    const json = await readS3Json({
      client: ctx.client,
      bucket: ctx.bucket,
      key,
    });
    snapshots.push(CachedLeaderboardSchema.parse(json));
  }

  const props =
    entry.chartType === "line"
      ? competitionLineChartProps({ entry, snapshots })
      : competitionBarChartProps({ entry, snapshots });
  const bytes = await competitionChartToImage(props);
  return {
    fileName: safeFileName(entry.id, "png"),
    bytes,
    sourceKeys: entry.snapshotKeys,
  };
}

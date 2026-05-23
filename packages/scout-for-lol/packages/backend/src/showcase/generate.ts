import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  CachedLeaderboardSchema,
  RawCurrentGameInfoSchema,
  RawMatchSchema,
  RankSchema,
  rankToLeaguePoints,
  resolveQueueTypeFromGame,
  type CachedLeaderboard,
  type QueueType,
  type RawMatch,
  type RawParticipant,
} from "@scout-for-lol/data";
import {
  competitionChartToImage,
  type CompetitionChartProps,
} from "@scout-for-lol/report";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  ShowcaseAssetIndexSchema,
  ShowcaseManifestSchema,
  type ShowcaseAsset,
  type ShowcaseEntry,
  type ShowcaseManifest,
  type ReportGraphMetric,
  validateRequiredShowcaseCoverage,
} from "#src/showcase/manifest.ts";
import { readS3Json, readS3ObjectBytes } from "#src/showcase/s3.ts";

export type GenerateShowcaseOptions = {
  manifestPath: string;
  outputDir: string;
  assetIndexPath: string;
  publicBasePath: string;
  bucket: string;
  client?: S3Client;
  generatedAt?: Date;
};

type GenerateEntryContext = {
  bucket: string;
  client: S3Client;
  outputDir: string;
  publicBasePath: string;
};

type GeneratedImage = {
  fileName: string;
  bytes: Uint8Array;
  sourceKeys: string[];
};

function optionalEntryFields(entry: ShowcaseEntry) {
  return {
    ...(entry.description === undefined
      ? {}
      : { description: entry.description }),
    ...(entry.state === undefined ? {} : { state: entry.state }),
    ...(entry.queue === undefined ? {} : { queue: entry.queue }),
    ...(entry.playerCount === undefined
      ? {}
      : { playerCount: entry.playerCount }),
  };
}

function safeFileName(id: string, extension: "png" | "webp"): string {
  const normalized = id.replaceAll(/[^a-z0-9-]/g, "-");
  return `${normalized}.${extension}`;
}

async function loadManifest(manifestPath: string): Promise<ShowcaseManifest> {
  const text = await Bun.file(manifestPath).text();
  const parsed: unknown = JSON.parse(text);
  return ShowcaseManifestSchema.parse(parsed);
}

async function writeImage(params: {
  outputDir: string;
  image: GeneratedImage;
}): Promise<void> {
  await mkdir(params.outputDir, { recursive: true });
  await Bun.write(
    path.join(params.outputDir, params.image.fileName),
    params.image.bytes,
  );
}

async function validateDataKey(params: {
  entry: ShowcaseEntry;
  bucket: string;
  client: S3Client;
  key: string;
}): Promise<void> {
  const payload = await readS3Json({
    client: params.client,
    bucket: params.bucket,
    key: params.key,
  });

  if (params.entry.state === "prematch") {
    RawCurrentGameInfoSchema.parse(payload);
    return;
  }

  if (params.entry.state === "postmatch") {
    RawMatchSchema.parse(payload);
    return;
  }

  throw new Error(
    `Cannot validate dataKey for ${params.entry.id} without state`,
  );
}

async function generateS3Image(
  entry: Extract<ShowcaseEntry, { kind: "s3-image" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  if (entry.dataKey !== undefined) {
    await validateDataKey({
      entry,
      bucket: ctx.bucket,
      client: ctx.client,
      key: entry.dataKey,
    });
  }

  const bytes = await readS3ObjectBytes({
    client: ctx.client,
    bucket: ctx.bucket,
    key: entry.imageKey,
  });
  return {
    fileName: safeFileName(entry.id, "png"),
    bytes,
    sourceKeys:
      entry.dataKey === undefined
        ? [entry.imageKey]
        : [entry.imageKey, entry.dataKey],
  };
}

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
  entry: Extract<ShowcaseEntry, { kind: "competition-graph" }>;
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

  const topEntries = latestSnapshot(sorted).entries.slice(0, 10);
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
  entry: Extract<ShowcaseEntry, { kind: "competition-graph" }>;
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

async function generateCompetitionGraph(
  entry: Extract<ShowcaseEntry, { kind: "competition-graph" }>,
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

async function generateReportGraph(
  entry: Extract<ShowcaseEntry, { kind: "report-graph" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  const totals = new Map<string, { value: number; games: number }>();
  for (const key of entry.matchKeys) {
    const json = await readS3Json({
      client: ctx.client,
      bucket: ctx.bucket,
      key,
    });
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

async function generateImageForEntry(
  entry: Exclude<ShowcaseEntry, { kind: "unsupported" }>,
  ctx: GenerateEntryContext,
): Promise<GeneratedImage> {
  switch (entry.kind) {
    case "s3-image":
      return await generateS3Image(entry, ctx);
    case "competition-graph":
      return await generateCompetitionGraph(entry, ctx);
    case "report-graph":
      return await generateReportGraph(entry, ctx);
  }
}

function unsupportedAsset(
  entry: Extract<ShowcaseEntry, { kind: "unsupported" }>,
): ShowcaseAsset {
  return {
    id: entry.id,
    title: entry.title,
    group: entry.group,
    kind: "unsupported",
    status: "unsupported",
    sourceKeys: [],
    reason: entry.reason,
    ...optionalEntryFields(entry),
  };
}

function generatedAsset(params: {
  entry: Exclude<ShowcaseEntry, { kind: "unsupported" }>;
  image: GeneratedImage;
  publicBasePath: string;
}): ShowcaseAsset {
  return {
    id: params.entry.id,
    title: params.entry.title,
    group: params.entry.group,
    kind: params.entry.kind,
    status: "generated",
    fileName: params.image.fileName,
    src: `${params.publicBasePath}/${params.image.fileName}`,
    byteLength: params.image.bytes.length,
    sourceKeys: params.image.sourceKeys,
    ...optionalEntryFields(params.entry),
  };
}

async function generateEntry(
  entry: ShowcaseEntry,
  ctx: GenerateEntryContext,
): Promise<ShowcaseAsset> {
  if (entry.kind === "unsupported") {
    return unsupportedAsset(entry);
  }

  const image = await generateImageForEntry(entry, ctx);
  await writeImage({ outputDir: ctx.outputDir, image });
  return generatedAsset({
    entry,
    image,
    publicBasePath: ctx.publicBasePath,
  });
}

export async function generateShowcaseAssets(
  options: GenerateShowcaseOptions,
): Promise<void> {
  const manifest = await loadManifest(options.manifestPath);
  const generatedAt = (options.generatedAt ?? new Date()).toISOString();
  const client = options.client ?? createS3Client();
  const ctx: GenerateEntryContext = {
    bucket: options.bucket,
    client,
    outputDir: options.outputDir,
    publicBasePath: options.publicBasePath,
  };

  const assets: ShowcaseAsset[] = [];
  for (const entry of manifest.entries) {
    assets.push(await generateEntry(entry, ctx));
  }

  const index = ShowcaseAssetIndexSchema.parse({
    version: 1,
    generatedAt,
    assets,
  });
  validateRequiredShowcaseCoverage(index);

  await mkdir(path.dirname(options.assetIndexPath), { recursive: true });
  await Bun.write(
    options.assetIndexPath,
    `${JSON.stringify(index, null, 2)}\n`,
  );
}

import {
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { QueueTypeSchema, type QueueType } from "@scout-for-lol/data";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  ShowcaseManifestSchema,
  type ShowcaseEntry,
} from "#src/showcase/manifest.ts";

const CliFlagNameSchema = z.enum([
  "bucket",
  "post-prefix",
  "prematch-prefix",
  "leaderboard-prefix",
  "out",
]);

const CliValuesSchema = z.strictObject({
  bucket: z.string().optional(),
  "post-prefix": z.string().optional(),
  "prematch-prefix": z.string().optional(),
  "leaderboard-prefix": z.string().optional(),
  out: z.string().optional(),
});

function parseCliValues(args: string[]): z.infer<typeof CliValuesSchema> {
  const entries: [string, string][] = [];
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      throw new Error(`Missing argument at index ${index.toString()}`);
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const rawName = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const name = CliFlagNameSchema.parse(rawName);
    if (seen.has(name)) {
      throw new Error(`Duplicate --${name}`);
    }
    seen.add(name);

    const value =
      equalsIndex === -1 ? args[index + 1] : raw.slice(equalsIndex + 1);
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw new Error(`Missing value for --${name}`);
    }
    if (equalsIndex === -1) {
      index += 1;
    }
    entries.push([name, value]);
  }

  return CliValuesSchema.parse(Object.fromEntries(entries));
}

const values = parseCliValues(Bun.argv.slice(2));

const MetadataSchema = z.record(z.string(), z.string());

type ImageCandidate = {
  key: string;
  dataKey: string;
  queueType: QueueType;
  trackedPlayerCount: number;
};

type VariantSpec = {
  id: string;
  title: string;
  group: string;
  state: "prematch" | "postmatch";
  queue: QueueType;
  playerCount: number;
};

function requiredFlag(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required --${name}`);
}

async function listKeys(params: {
  client: S3Client;
  bucket: string;
  prefix: string;
}): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await params.client.send(
      new ListObjectsV2Command({
        Bucket: params.bucket,
        Prefix: params.prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      const keyResult = z.string().safeParse(object.Key);
      if (keyResult.success) {
        keys.push(keyResult.data);
      }
    }

    isTruncated = response.IsTruncated === true;
    continuationToken = response.NextContinuationToken;
  }
  return keys;
}

async function objectMetadata(params: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<Map<string, string>> {
  const response = await params.client.send(
    new HeadObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );
  const metadata = MetadataSchema.parse(response.Metadata ?? {});
  return new Map(
    Object.entries(metadata).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function trackedPlayerCount(metadata: Map<string, string>): number {
  const trackedPlayers = metadata.get("trackedplayers") ?? "";
  return trackedPlayers
    .split(",")
    .map((player) => player.trim())
    .filter((player) => player.length > 0).length;
}

function queueType(metadata: Map<string, string>): string | undefined {
  return metadata.get("queuetype") ?? metadata.get("queueid");
}

function postmatchDataKey(imageKey: string): string {
  return imageKey.replace(/\/report\.png$/, "/match.json");
}

function prematchDataKey(imageKey: string): string {
  return imageKey.replace(/\/loading-screen\.png$/, "/spectator-data.json");
}

async function discoverImageCandidates(params: {
  client: S3Client;
  bucket: string;
  prefix: string;
  imageSuffix: "/report.png" | "/loading-screen.png";
}): Promise<ImageCandidate[]> {
  const keys = await listKeys(params);
  const candidates: ImageCandidate[] = [];

  for (const key of keys.filter((candidate) =>
    candidate.endsWith(params.imageSuffix),
  )) {
    const metadata = await objectMetadata({
      client: params.client,
      bucket: params.bucket,
      key,
    });
    const queueParseResult = QueueTypeSchema.safeParse(queueType(metadata));
    if (!queueParseResult.success) {
      continue;
    }

    candidates.push({
      key,
      dataKey:
        params.imageSuffix === "/report.png"
          ? postmatchDataKey(key)
          : prematchDataKey(key),
      queueType: queueParseResult.data,
      trackedPlayerCount: trackedPlayerCount(metadata),
    });
  }

  return candidates;
}

function findCandidate(params: {
  candidates: ImageCandidate[];
  spec: VariantSpec;
}): ImageCandidate | undefined {
  return params.candidates
    .toSorted((left, right) => right.key.localeCompare(left.key))
    .find(
      (candidate) =>
        candidate.queueType === params.spec.queue &&
        candidate.trackedPlayerCount === params.spec.playerCount,
    );
}

function unsupportedEntry(spec: VariantSpec, reason: string): ShowcaseEntry {
  return {
    kind: "unsupported",
    id: spec.id,
    title: spec.title,
    group: spec.group,
    state: spec.state,
    queue: spec.queue,
    playerCount: spec.playerCount,
    reason,
  };
}

function s3Entry(params: {
  spec: VariantSpec;
  candidate: ImageCandidate;
}): ShowcaseEntry {
  return {
    kind: "s3-image",
    id: params.spec.id,
    title: params.spec.title,
    group: params.spec.group,
    state: params.spec.state,
    queue: params.spec.queue,
    playerCount: params.spec.playerCount,
    imageKey: params.candidate.key,
    dataKey: params.candidate.dataKey,
  };
}

function buildEntries(params: {
  specs: VariantSpec[];
  prematchCandidates: ImageCandidate[];
  postmatchCandidates: ImageCandidate[];
}): ShowcaseEntry[] {
  return params.specs.map((spec) => {
    if (spec.id.includes("ranked-flex-4")) {
      return unsupportedEntry(
        spec,
        "Ranked Flex does not normally allow four-player parties, and no real supported payload was found.",
      );
    }

    if (spec.id.includes("ranked-flex-5")) {
      return unsupportedEntry(
        spec,
        "No real supported five-player Ranked Flex payload was found in S3.",
      );
    }

    const candidates =
      spec.state === "prematch"
        ? params.prematchCandidates
        : params.postmatchCandidates;
    const candidate = findCandidate({ candidates, spec });
    if (candidate === undefined) {
      return unsupportedEntry(
        spec,
        `No real ${spec.queue} ${spec.state} S3 object was found for ${spec.playerCount.toString()} tracked player(s).`,
      );
    }
    return s3Entry({ spec, candidate });
  });
}

const SHOWCASE_STATES = ["prematch", "postmatch"] as const;

function playerCountLabel(playerCount: number): string {
  const labels = new Map([
    [1, "One Player"],
    [2, "Two Players"],
    [3, "Three Players"],
    [4, "Four Players"],
    [5, "Five Players"],
  ]);
  return labels.get(playerCount) ?? `${playerCount.toString()} Players`;
}

function playerCountSpec(params: {
  prefix: string;
  label: string;
  group: string;
  queue: QueueType;
  playerCount: number;
}): VariantSpec[] {
  return SHOWCASE_STATES.map((state) => ({
    id: `${params.prefix}-${params.playerCount.toString()}-${state}`,
    title: `${params.label} ${state === "prematch" ? "Pre-Match" : "Post-Match"}, ${playerCountLabel(params.playerCount)}`,
    group: params.group,
    state,
    queue: params.queue,
    playerCount: params.playerCount,
  }));
}

function singleQueueSpec(params: {
  id: string;
  title: string;
  group: string;
  queue: QueueType;
  playerCount: number;
}): VariantSpec[] {
  return SHOWCASE_STATES.map((state) => ({
    id: `${params.id}-${state}`,
    title: `${params.title} ${state === "prematch" ? "Pre-Match" : "Post-Match"}`,
    group: params.group,
    state,
    queue: params.queue,
    playerCount: params.playerCount,
  }));
}

function variantSpecs(): VariantSpec[] {
  return [
    ...singleQueueSpec({
      id: "draft",
      title: "Draft",
      group: "Draft",
      queue: "draft pick",
      playerCount: 1,
    }),
    ...[1, 2].flatMap((playerCount) =>
      playerCountSpec({
        prefix: "ranked-solo",
        label: "Ranked Solo",
        group: "Ranked Solo",
        queue: "solo",
        playerCount,
      }),
    ),
    ...[1, 2, 3, 4, 5].flatMap((playerCount) =>
      playerCountSpec({
        prefix: "ranked-flex",
        label: "Ranked Flex",
        group: "Ranked Flex",
        queue: "flex",
        playerCount,
      }),
    ),
    ...singleQueueSpec({
      id: "arena-3",
      title: "Arena",
      group: "Arena",
      queue: "arena",
      playerCount: 3,
    }),
    ...singleQueueSpec({
      id: "aram",
      title: "ARAM",
      group: "ARAM",
      queue: "aram",
      playerCount: 1,
    }),
    ...singleQueueSpec({
      id: "aram-mayhem",
      title: "ARAM Mayhem",
      group: "ARAM Mayhem",
      queue: "aram mayhem",
      playerCount: 1,
    }),
  ];
}

function leaderboardSnapshotGroups(keys: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const match = /^leaderboards\/competition-\d+\/snapshots\/.+\.json$/.exec(
      key,
    );
    if (match === null) {
      continue;
    }
    const competitionKey = key.split("/snapshots/")[0];
    if (competitionKey === undefined) {
      continue;
    }
    const group = groups.get(competitionKey) ?? [];
    group.push(key);
    groups.set(competitionKey, group);
  }
  return groups;
}

function competitionGraphEntry(keys: string[]): ShowcaseEntry {
  const groups = leaderboardSnapshotGroups(keys);
  const selected = [...groups.values()]
    .filter((group) => group.length > 1)
    .toSorted((left, right) => right.length - left.length)[0];

  if (selected === undefined) {
    return {
      kind: "unsupported",
      id: "competition-graph",
      title: "Competition Graph",
      group: "Graphs",
      reason:
        "No leaderboard snapshot series with at least two points was found.",
    };
  }

  return {
    kind: "competition-graph",
    id: "competition-graph",
    title: "Competition Progress",
    group: "Graphs",
    description: "Real leaderboard snapshots rendered as a marketing chart.",
    snapshotKeys: selected.toSorted().slice(-10),
    chartType: "line",
    yAxisLabel: "Score",
  };
}

function reportGraphEntry(
  postmatchCandidates: ImageCandidate[],
): ShowcaseEntry {
  const matchKeys = postmatchCandidates
    .map((candidate) => candidate.dataKey)
    .slice(0, 12);

  if (matchKeys.length === 0) {
    return {
      kind: "unsupported",
      id: "report-graph",
      title: "Report Graph",
      group: "Graphs",
      reason: "No postmatch match.json keys were found for report graph input.",
    };
  }

  return {
    kind: "report-graph",
    id: "report-graph",
    title: "Scheduled Report Damage",
    group: "Graphs",
    description:
      "Real match payloads aggregated into a scheduled-report chart.",
    matchKeys,
    metric: "damage_to_champions",
    yAxisLabel: "Damage to Champions",
  };
}

const bucket = requiredFlag("bucket");
const client = createS3Client();
const postPrefix = values["post-prefix"] ?? "games/";
const prematchPrefix = values["prematch-prefix"] ?? "prematch/";
const leaderboardPrefix = values["leaderboard-prefix"] ?? "leaderboards/";

const [postmatchCandidates, prematchCandidates, leaderboardKeys] =
  await Promise.all([
    discoverImageCandidates({
      client,
      bucket,
      prefix: postPrefix,
      imageSuffix: "/report.png",
    }),
    discoverImageCandidates({
      client,
      bucket,
      prefix: prematchPrefix,
      imageSuffix: "/loading-screen.png",
    }),
    listKeys({ client, bucket, prefix: leaderboardPrefix }),
  ]);

const manifest = ShowcaseManifestSchema.parse({
  version: 1,
  entries: [
    ...buildEntries({
      specs: variantSpecs(),
      prematchCandidates,
      postmatchCandidates,
    }),
    competitionGraphEntry(leaderboardKeys),
    reportGraphEntry(postmatchCandidates),
  ],
});

const output = `${JSON.stringify(manifest, null, 2)}\n`;
await (typeof values.out === "string" && values.out.length > 0
  ? Bun.write(values.out, output)
  : Bun.stdout.write(output));

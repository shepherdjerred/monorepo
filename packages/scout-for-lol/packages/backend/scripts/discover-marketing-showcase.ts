import {
  GetObjectCommand,
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
import {
  DISCORD_SHOWCASE_TEMPLATES,
  discordScreenshotEntry,
} from "#src/showcase/discord-templates.ts";
import { readS3JsonOptional } from "#src/showcase/s3.ts";

const CliFlagNameSchema = z.enum([
  "bucket",
  "post-prefix",
  "prematch-prefix",
  "leaderboard-prefix",
  "out",
  "prev",
  "max-head",
]);

const CliValuesSchema = z.strictObject({
  bucket: z.string().optional(),
  "post-prefix": z.string().optional(),
  "prematch-prefix": z.string().optional(),
  "leaderboard-prefix": z.string().optional(),
  out: z.string().optional(),
  prev: z.string().optional(),
  "max-head": z.string().optional(),
});

/** Safety cap on metadata reads per prefix if a wanted combo is unexpectedly scarce. */
const DEFAULT_MAX_HEAD = 800;

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
  // SeaweedFS's public S3 ingress 403s HeadObject and ranged GETs, so we
  // read user metadata from a plain GetObject's response headers and cancel
  // the body stream before the image payload is transferred.
  const response = await params.client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );
  const metadata = MetadataSchema.parse(response.Metadata ?? {});
  await response.Body?.transformToWebStream().cancel();
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

function comboKey(queue: QueueType, playerCount: number): string {
  return `${queue}:${playerCount.toString()}`;
}

/**
 * Walk the prefix newest-first (date-partitioned keys sort lexicographically),
 * HeadObject-ing each report to read its queue/tracked-player metadata, and
 * stop as soon as every wanted `(queue, playerCount)` combo has been seen — or
 * a head budget is hit. This avoids a full ~16K-object scan: common combos are
 * found within the newest few hundred objects.
 */
async function discoverImageCandidates(params: {
  client: S3Client;
  bucket: string;
  prefix: string;
  imageSuffix: "/report.png" | "/loading-screen.png";
  wantedCombos: Set<string>;
  maxHead: number;
}): Promise<{ candidates: ImageCandidate[]; headCount: number }> {
  const keys = (await listKeys(params))
    .filter((candidate) => candidate.endsWith(params.imageSuffix))
    .toSorted((left, right) => right.localeCompare(left));

  const candidates: ImageCandidate[] = [];
  const remaining = new Set(params.wantedCombos);
  let headCount = 0;

  for (const key of keys) {
    if (remaining.size === 0 || headCount >= params.maxHead) {
      break;
    }
    const metadata = await objectMetadata({
      client: params.client,
      bucket: params.bucket,
      key,
    });
    headCount += 1;
    const queueParseResult = QueueTypeSchema.safeParse(queueType(metadata));
    if (!queueParseResult.success) {
      continue;
    }

    const tracked = trackedPlayerCount(metadata);
    candidates.push({
      key,
      dataKey:
        params.imageSuffix === "/report.png"
          ? postmatchDataKey(key)
          : prematchDataKey(key),
      queueType: queueParseResult.data,
      trackedPlayerCount: tracked,
    });
    remaining.delete(comboKey(queueParseResult.data, tracked));
  }

  return { candidates, headCount };
}

function findCandidate(
  candidates: ImageCandidate[],
  queue: QueueType,
  playerCount: number,
): ImageCandidate | undefined {
  return candidates
    .toSorted((left, right) => right.key.localeCompare(left.key))
    .find(
      (candidate) =>
        candidate.queueType === queue &&
        candidate.trackedPlayerCount === playerCount,
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

/**
 * Use a freshly-found entry if available, else fall back to the previous
 * manifest's entry (preserving an older-but-valid image so required coverage
 * never regresses), else mark unsupported.
 */
function withFallback(
  id: string,
  fresh: ShowcaseEntry | undefined,
  prevById: Map<string, ShowcaseEntry>,
  unsupported: ShowcaseEntry,
): ShowcaseEntry {
  return fresh ?? prevById.get(id) ?? unsupported;
}

function buildEntries(params: {
  specs: VariantSpec[];
  prematchCandidates: ImageCandidate[];
  postmatchCandidates: ImageCandidate[];
  prevById: Map<string, ShowcaseEntry>;
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
    const candidate = findCandidate(candidates, spec.queue, spec.playerCount);
    return withFallback(
      spec.id,
      candidate === undefined ? undefined : s3Entry({ spec, candidate }),
      params.prevById,
      unsupportedEntry(
        spec,
        `No recent ${spec.queue} ${spec.state} report was found within the head budget for ${spec.playerCount.toString()} tracked player(s).`,
      ),
    );
  });
}

/**
 * One `discord-screenshot` entry per curated template, sourced from the
 * most-recent matching postmatch report (fresh, else previous, else
 * unsupported).
 */
function discordEntries(
  postmatchCandidates: ImageCandidate[],
  prevById: Map<string, ShowcaseEntry>,
): ShowcaseEntry[] {
  return DISCORD_SHOWCASE_TEMPLATES.map((template) => {
    const candidate = findCandidate(
      postmatchCandidates,
      template.queue,
      template.playerCount,
    );
    return withFallback(
      template.id,
      candidate === undefined
        ? undefined
        : discordScreenshotEntry(template, {
            imageKey: candidate.key,
            dataKey: candidate.dataKey,
          }),
      prevById,
      {
        kind: "unsupported",
        id: template.id,
        title: template.title,
        group: template.group,
        reason: `No recent ${template.queue} postmatch report was found for the Discord composite.`,
      },
    );
  });
}

async function loadPrevEntries(
  path: string | undefined,
): Promise<Map<string, ShowcaseEntry>> {
  if (path === undefined || path.length === 0) {
    return new Map();
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return new Map();
  }
  const parsed: unknown = JSON.parse(await file.text());
  const manifest = ShowcaseManifestSchema.parse(parsed);
  return new Map(manifest.entries.map((entry) => [entry.id, entry]));
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

const SnapshotEntriesSchema = z.object({ entries: z.array(z.unknown()) });

/**
 * Evenly sample up to `count` keys across the full sorted range so the chart
 * spans the whole competition (showing real movement) rather than just the
 * recent — often flat — tail.
 */
function sampleEvenly(sortedKeys: string[], count: number): string[] {
  if (sortedKeys.length <= count) {
    return sortedKeys;
  }
  const step = (sortedKeys.length - 1) / (count - 1);
  const picked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = sortedKeys[Math.round(index * step)];
    if (key !== undefined && !picked.includes(key)) {
      picked.push(key);
    }
  }
  return picked;
}

async function snapshotHasEntries(params: {
  client: S3Client;
  bucket: string;
  key: string;
}): Promise<boolean> {
  const json = await readS3JsonOptional(params);
  const parsed = SnapshotEntriesSchema.safeParse(json);
  return parsed.success && parsed.data.entries.length > 0;
}

async function competitionGraphEntry(params: {
  client: S3Client;
  bucket: string;
  keys: string[];
  prevById: Map<string, ShowcaseEntry>;
}): Promise<ShowcaseEntry> {
  // Prefer the competition with the most snapshots whose *latest* snapshot is
  // actually populated — a dead/cleared leaderboard has snapshots but no
  // entries, which renders as an empty chart.
  const candidates = [...leaderboardSnapshotGroups(params.keys).values()]
    .filter((group) => group.length > 1)
    .toSorted((left, right) => right.length - left.length);

  for (const group of candidates) {
    const snapshotKeys = group.toSorted();
    const latestKey = snapshotKeys.at(-1);
    if (latestKey === undefined) {
      continue;
    }
    if (
      !(await snapshotHasEntries({
        client: params.client,
        bucket: params.bucket,
        key: latestKey,
      }))
    ) {
      continue;
    }
    return {
      kind: "competition-graph",
      id: "competition-graph",
      title: "Competition Progress",
      group: "Graphs",
      description: "Real leaderboard snapshots rendered as a marketing chart.",
      snapshotKeys: sampleEvenly(snapshotKeys, 12),
      chartType: "line",
      yAxisLabel: "Score",
    };
  }

  return (
    params.prevById.get("competition-graph") ?? {
      kind: "unsupported",
      id: "competition-graph",
      title: "Competition Graph",
      group: "Graphs",
      reason: "No competition with a populated recent leaderboard was found.",
    }
  );
}

function reportGraphEntry(
  postmatchCandidates: ImageCandidate[],
  prevById: Map<string, ShowcaseEntry>,
): ShowcaseEntry {
  const matchKeys = postmatchCandidates
    .map((candidate) => candidate.dataKey)
    .slice(0, 12);

  if (matchKeys.length === 0) {
    return (
      prevById.get("report-graph") ?? {
        kind: "unsupported",
        id: "report-graph",
        title: "Report Graph",
        group: "Graphs",
        reason:
          "No postmatch match.json keys were found for report graph input.",
      }
    );
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
const maxHead = z.coerce
  .number()
  .int()
  .positive()
  .catch(DEFAULT_MAX_HEAD)
  .parse(values["max-head"] ?? DEFAULT_MAX_HEAD);

// Stop scanning once these reliably-frequent combos are seen (single tracked
// player in Ranked Solo + Flex appear within the newest few dozen reports).
// Everything else — multi-player parties, Arena, ARAM, rotating modes — is
// best-effort within the budget and otherwise preserved from the previous
// manifest, so the scan stays in the newest objects instead of the whole
// bucket. This is what keeps discover fast (seconds, not minutes).
const wantedCombos = new Set(
  variantSpecs()
    .filter(
      (spec) =>
        spec.state === "postmatch" &&
        spec.playerCount === 1 &&
        (spec.queue === "solo" || spec.queue === "flex"),
    )
    .map((spec) => comboKey(spec.queue, spec.playerCount)),
);

const prevById = await loadPrevEntries(values.prev);

const [postmatch, prematch, leaderboardKeys] = await Promise.all([
  discoverImageCandidates({
    client,
    bucket,
    prefix: postPrefix,
    imageSuffix: "/report.png",
    wantedCombos,
    maxHead,
  }),
  discoverImageCandidates({
    client,
    bucket,
    prefix: prematchPrefix,
    imageSuffix: "/loading-screen.png",
    wantedCombos,
    maxHead,
  }),
  listKeys({ client, bucket, prefix: leaderboardPrefix }),
]);

process.stderr.write(
  `Headed ${postmatch.headCount.toString()} postmatch + ${prematch.headCount.toString()} prematch object(s) (budget ${maxHead.toString()}).\n`,
);

const competitionEntry = await competitionGraphEntry({
  client,
  bucket,
  keys: leaderboardKeys,
  prevById,
});

const manifest = ShowcaseManifestSchema.parse({
  version: 1,
  entries: [
    ...buildEntries({
      specs: variantSpecs(),
      prematchCandidates: prematch.candidates,
      postmatchCandidates: postmatch.candidates,
      prevById,
    }),
    ...discordEntries(postmatch.candidates, prevById),
    competitionEntry,
    reportGraphEntry(postmatch.candidates, prevById),
  ],
});

const output = `${JSON.stringify(manifest, null, 2)}\n`;
await (typeof values.out === "string" && values.out.length > 0
  ? Bun.write(values.out, output)
  : Bun.stdout.write(output));

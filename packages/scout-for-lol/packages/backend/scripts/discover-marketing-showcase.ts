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
import { getTrackedPlayerCount } from "#src/storage/s3-metadata.ts";

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

    const tracked = getTrackedPlayerCount(metadata);
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
 * An entry that pins its own `bucket` was curated by hand against a source this
 * scan cannot even see — discover only ever lists the run's `--bucket`. Without
 * treating it as untouchable, a re-curation silently reverts that choice: the
 * fresh entry is built from scratch with no `bucket` field, so generate falls
 * back to the run bucket and renders a different object (or fails on
 * NoSuchKey). The `--prev` fallback below cannot save it either, because it is
 * only reached when nothing fresh was found at all.
 *
 * Carrying only the `bucket` field onto a fresh candidate would be worse than
 * useless: that candidate's key was discovered in the run bucket and generally
 * does not exist in the pinned one.
 */
function pinnedEntry(
  prevById: Map<string, ShowcaseEntry>,
  id: string,
): ShowcaseEntry | undefined {
  const prev = prevById.get(id);
  if (prev === undefined || prev.kind === "unsupported") {
    return undefined;
  }
  return prev.bucket === undefined ? undefined : prev;
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
    const pinned = pinnedEntry(params.prevById, spec.id);
    if (pinned !== undefined) {
      return pinned;
    }

    // These two short-circuit before the candidate lookup and before the
    // `--prev` fallback, so they are permanent rather than budget-dependent.
    // Say so: the generic miss reason below means "not found within the head
    // budget", which invites someone to raise the budget and rerun. Re-scanning
    // will not help here — a survey of prod found no four- or five-tracked-player
    // Flex objects at all.
    if (spec.id.includes("ranked-flex-4")) {
      return unsupportedEntry(
        spec,
        "Ranked Flex does not form four-player premades in this data set; no such payload exists in S3, so this is not a scan-budget miss.",
      );
    }

    if (spec.id.includes("ranked-flex-5")) {
      return unsupportedEntry(
        spec,
        "No five-tracked-player Ranked Flex payload exists in S3; this is a permanent gap, not a scan-budget miss.",
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
    const pinned = pinnedEntry(prevById, template.id);
    if (pinned !== undefined) {
      return pinned;
    }

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
  /**
   * Which states this mode can actually produce. Defaults to both.
   *
   * Some rotating modes only ever yield a pre-match loading screen: Riot's
   * Match-V5 exposes no post-game payload for them, so no amount of scanning
   * will find a report. Declaring that here keeps the mode out of the spec set
   * entirely, rather than emitting a variant that can only ever resolve to an
   * "not found within the head budget" miss which the next run re-searches.
   */
  states?: readonly ("prematch" | "postmatch")[];
}): VariantSpec[] {
  return (params.states ?? SHOWCASE_STATES).map((state) => ({
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
    // Four tracked players, not three. A survey of a week of prod reports found
    // arena at tracked-player counts 1, 2 and 4 but never 3, and a four-player
    // subteam renders a wider, denser card.
    ...singleQueueSpec({
      id: "arena-4",
      title: "Arena",
      group: "Arena",
      queue: "arena",
      playerCount: 4,
    }),
    // League Classic is pre-match only: Riot's API exposes no post-game payload
    // for it. Verified against prod — zero `classic` reports across 1,078
    // post-match objects spanning its launch window, against 8 loading screens
    // in the same period. It also has its own loading-screen renderer
    // (report/src/html/loading-screen/classic-layout.tsx), so it is worth
    // showing.
    ...singleQueueSpec({
      id: "classic",
      title: "League Classic",
      group: "League Classic",
      queue: "classic",
      playerCount: 1,
      states: ["prematch"],
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
  // Checked before the snapshot scan below, which is the expensive part.
  const pinned = pinnedEntry(params.prevById, "competition-graph");
  if (pinned !== undefined) {
    return pinned;
  }

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
      description: "How your group's ranks moved across the season.",
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
  const pinned = pinnedEntry(prevById, "report-graph");
  if (pinned !== undefined) {
    return pinned;
  }

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
    description: "Damage to champions across your group's recent games.",
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

/**
 * Combos verified not to exist in the bucket, excluded so the scan can still
 * terminate early.
 *
 * `remaining` empties only when EVERY wanted combo has been seen, so a single
 * unobtainable combo pins both scans to the full head budget. These two are
 * also hard-coded unsupported in `buildEntries`, so scanning for them buys
 * nothing: Ranked Flex does not form four- or five-player premades in this
 * data set.
 */
const KNOWN_ABSENT_COMBOS = new Set([comboKey("flex", 4), comboKey("flex", 5)]);

/**
 * What each scan is looking for, derived from the spec set rather than a
 * hand-maintained shortlist.
 *
 * This was previously hard-coded to `{solo:1, flex:1}` — the two combos that
 * turn up within the newest few dozen objects. Because the set is the loop
 * terminator, the scan stopped almost immediately, and every rarer variant
 * (Arena, ARAM Mayhem, multi-player parties, and now League Classic) was found
 * only by luck and otherwise carried forward from `--prev` indefinitely. That
 * is why the committed manifest still referenced May and June objects.
 *
 * Split by state because availability differs: League Classic has pre-match
 * loading screens but no post-match report at all, so a shared set would leave
 * the post-match scan hunting for something that cannot exist.
 *
 * Cost: the scan now walks back until every reachable combo is satisfied or
 * `--max-head` is hit, so expect it to read materially more object metadata
 * than before. That is the intended trade — a stale showcase is worse than a
 * slower re-curation, and this runs weekly at most.
 */
function wantedCombosForState(state: "prematch" | "postmatch"): Set<string> {
  return new Set(
    variantSpecs()
      .filter((spec) => spec.state === state)
      .map((spec) => comboKey(spec.queue, spec.playerCount))
      .filter((key) => !KNOWN_ABSENT_COMBOS.has(key)),
  );
}

const prevById = await loadPrevEntries(values.prev);

const [postmatch, prematch, leaderboardKeys] = await Promise.all([
  discoverImageCandidates({
    client,
    bucket,
    prefix: postPrefix,
    imageSuffix: "/report.png",
    wantedCombos: wantedCombosForState("postmatch"),
    maxHead,
  }),
  discoverImageCandidates({
    client,
    bucket,
    prefix: prematchPrefix,
    imageSuffix: "/loading-screen.png",
    wantedCombos: wantedCombosForState("prematch"),
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

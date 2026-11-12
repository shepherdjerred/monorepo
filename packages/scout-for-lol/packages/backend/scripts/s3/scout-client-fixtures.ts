import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import {
  SCOUT_CLIENT_OBSERVATION_SCHEMA_VERSION,
  SCOUT_CLIENT_PROTOCOL_VERSION,
  ScoutClientObservationSchema,
  withoutScoutClientCredentials,
} from "@scout-for-lol/data/index.ts";
import { rawMatchS3Region } from "./raw-match-s3.ts";

/**
 * Extract a Scout Client game bundle from the beta archive into a redacted
 * test fixture under `packages/scout-for-lol/testdata/lcu/`.
 *
 * Credentials: use the existing 1Password-backed path, for example
 *   scripts/onepassword/with-service-account.sh \
 *     bun run scripts/s3/scout-client-fixtures.ts --bucket scout-beta \
 *     --aws-profile seaweedfs --match-id NA1_5663121007 --date 2026-10-18 \
 *     --name classic
 *
 * The output `lcu-postgame-<name>.json` has the shape of
 * `lcu-postgame-ranked.json`: `{ endOfGame, matchHistory, timeline }`.
 */

const FAKE_UUID_PREFIX = "5c0a7000-0000-4000-8000-";
const FAKE_TAG_LINE = "TEST";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const NAME_KEYS = new Set(["gameName", "summonerName", "riotIdGameName"]);
const TAG_KEYS = new Set(["tagLine", "riotIdTagLine"]);

const JsonRecordSchema = z.record(z.string(), z.unknown());

const BundleSchema = z.object({
  data: z.object({
    endOfGame: JsonRecordSchema,
    matchHistory: JsonRecordSchema,
    timeline: JsonRecordSchema,
  }),
  resource: z.literal("post_game"),
});

export type ClientBundle = z.infer<typeof BundleSchema>;

export type PostgameFixture = {
  matchHistory: unknown;
  endOfGame: unknown;
  timeline: unknown;
};

const IdentitySchema = z.object({
  puuid: z.string(),
  name: z.string(),
  summonerId: z.number().optional(),
});

type Identity = z.infer<typeof IdentitySchema>;

const PlayerSchema = z
  .object({
    puuid: z.string().optional(),
    gameName: z.string().optional(),
    riotIdGameName: z.string().optional(),
    summonerName: z.string().optional(),
    summonerId: z.number().optional(),
  })
  .loose();

function fakeUuid(index: number): string {
  return `${FAKE_UUID_PREFIX}${index.toString(16).padStart(12, "0")}`;
}

function realIdentities(bundle: ClientBundle): Identity[] {
  const { endOfGame, matchHistory } = bundle.data;
  const identities = z
    .object({
      participantIdentities: z.array(
        z.object({ participantId: z.number(), player: PlayerSchema }),
      ),
    })
    .parse(matchHistory).participantIdentities;
  const localPuuid = z
    .object({ localPlayer: z.object({ puuid: z.string() }) })
    .parse(endOfGame).localPlayer.puuid;

  // Match the committed fixtures: the local player is Player1, everyone else
  // follows in participant order.
  const ordered = [...identities].sort(
    (a, b) => a.participantId - b.participantId,
  );
  const local = ordered.filter((entry) => entry.player.puuid === localPuuid);
  if (local.length !== 1) {
    throw new Error(
      "expected exactly one local player in participantIdentities",
    );
  }
  const rest = ordered.filter((entry) => entry.player.puuid !== localPuuid);
  const result: Identity[] = [];
  for (const entry of [...local, ...rest]) {
    const { puuid } = entry.player;
    // Bots carry the nil UUID and no real account.
    if (
      puuid === undefined ||
      puuid === NIL_UUID ||
      !UUID_PATTERN.test(puuid)
    ) {
      continue;
    }
    result.push(
      IdentitySchema.parse({
        puuid,
        name: entry.player.gameName ?? entry.player.summonerName ?? "",
        summonerId: entry.player.summonerId,
      }),
    );
  }
  return result;
}

type Mapping = {
  uuids: Map<string, string>;
  names: Map<string, string>;
  summonerIds: Map<number, number>;
};

function buildMapping(identities: readonly Identity[]): Mapping {
  const mapping: Mapping = {
    uuids: new Map(),
    names: new Map(),
    summonerIds: new Map(),
  };
  identities.forEach((identity, index) => {
    const number = index + 1;
    mapping.uuids.set(identity.puuid, fakeUuid(number));
    if (identity.name !== "") {
      mapping.names.set(identity.name, `Player${String(number)}`);
    }
    if (identity.summonerId !== undefined) {
      mapping.summonerIds.set(identity.summonerId, 1000 + number);
    }
  });
  return mapping;
}

function redactValue(value: unknown, key: string, mapping: Mapping): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, key, mapping));
  }
  if (value !== null && typeof value === "object") {
    // Sorted keys, like the committed fixtures, so diffs stay stable.
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right, "en"))
        .map(([childKey, child]) => [
          childKey,
          redactValue(child, childKey, mapping),
        ]),
    );
  }
  if (typeof value === "string") {
    const fakeId = mapping.uuids.get(value);
    if (fakeId !== undefined) {
      return fakeId;
    }
    if (NAME_KEYS.has(key)) {
      return value === "" ? value : (mapping.names.get(value) ?? value);
    }
    if (TAG_KEYS.has(key)) {
      return value === "" ? value : FAKE_TAG_LINE;
    }
    return value;
  }
  if (typeof value === "number" && key === "summonerId") {
    return mapping.summonerIds.get(value) ?? value;
  }
  return value;
}

/**
 * Throw if any real identity survives redaction. Real names are checked as
 * whole JSON strings anywhere in the document, so a name that collides with
 * an unrelated field fails loudly instead of leaking.
 */
export function assertRedacted(
  fixture: PostgameFixture,
  identities: readonly Identity[],
): void {
  const text = JSON.stringify(fixture);
  for (const identity of identities) {
    if (text.includes(identity.puuid)) {
      throw new Error("a real PUUID survived redaction");
    }
    if (identity.name !== "" && text.includes(JSON.stringify(identity.name))) {
      throw new Error("a real player name survived redaction");
    }
    if (
      identity.summonerId !== undefined &&
      new RegExp(
        String.raw`"summonerId":${String(identity.summonerId)}\b`,
      ).test(text)
    ) {
      throw new Error("a real summoner id survived redaction");
    }
  }
  if (/\b[A-Za-z0-9_-]{78}\b/.test(text)) {
    throw new Error("a 78-character PUUID-shaped value survived redaction");
  }
}

/** Strip credentials, then replace every real identity with a stable fake. */
export function redactClientBundle(rawBundle: unknown): PostgameFixture {
  const bundle = BundleSchema.parse(rawBundle);
  const observation = withoutScoutClientCredentials(
    ScoutClientObservationSchema.parse({
      protocolVersion: SCOUT_CLIENT_PROTOCOL_VERSION,
      schemaVersion: SCOUT_CLIENT_OBSERVATION_SCHEMA_VERSION,
      observationId: crypto.randomUUID(),
      sequence: 0,
      capturedAt: new Date(0).toISOString(),
      appVersion: "fixture",
      kind: "post_game",
      payload: bundle,
    }),
  );
  const stripped = BundleSchema.parse(observation.payload);
  const identities = realIdentities(stripped);
  const mapping = buildMapping(identities);
  const { endOfGame, matchHistory, timeline } = stripped.data;
  const fixture: PostgameFixture = {
    matchHistory: redactValue(matchHistory, "", mapping),
    endOfGame: redactValue(endOfGame, "", mapping),
    timeline: redactValue(timeline, "", mapping),
  };
  assertRedacted(fixture, identities);
  return fixture;
}

const RawArgsSchema = z.array(z.string());

function optionalFlagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function requiredFlagValue(args: readonly string[], flag: string): string {
  const value = optionalFlagValue(args, flag);
  if (value === undefined) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return value;
}

export const FixtureCliConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  matchId: z.string().regex(/^[A-Z0-9]+_\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().regex(/^[a-z0-9-]+$/),
  observationKey: z.string().min(1).optional(),
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.url().optional(),
});

export type FixtureCliConfig = z.infer<typeof FixtureCliConfigSchema>;

const OUTPUT_DIRECTORY = new URL("../../../../testdata/lcu/", import.meta.url);

export function bundleKey(config: FixtureCliConfig): string {
  return `games/${config.date.replaceAll("-", "/")}/${config.matchId}/client-bundle.json`;
}

async function readJson(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<unknown> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.Body === undefined) {
    throw new Error(`S3 object ${key} has no body`);
  }
  const parsed: unknown = JSON.parse(await response.Body.transformToString());
  return parsed;
}

async function readBundle(
  client: S3Client,
  config: FixtureCliConfig,
): Promise<unknown> {
  if (config.observationKey === undefined) {
    return readJson(client, config.bucket, bundleKey(config));
  }
  // The raw archived observation wraps the same payload with its envelope.
  const document = z
    .object({ payload: z.unknown() })
    .parse(await readJson(client, config.bucket, config.observationKey));
  return document.payload;
}

async function main(): Promise<void> {
  const args = RawArgsSchema.parse(Bun.argv.slice(2));
  const config = FixtureCliConfigSchema.parse({
    bucket: requiredFlagValue(args, "--bucket"),
    matchId: requiredFlagValue(args, "--match-id"),
    date: requiredFlagValue(args, "--date"),
    name: requiredFlagValue(args, "--name"),
    observationKey: optionalFlagValue(args, "--observation-key"),
    awsProfile: optionalFlagValue(args, "--aws-profile"),
    endpointUrl: optionalFlagValue(args, "--endpoint-url"),
  });
  if (config.awsProfile !== undefined) {
    Bun.env["AWS_PROFILE"] = config.awsProfile;
    Bun.env["AWS_SDK_LOAD_CONFIG"] = "1";
  }
  const client = new S3Client({
    forcePathStyle: true,
    region: rawMatchS3Region(),
    ...(config.endpointUrl === undefined
      ? {}
      : { endpoint: config.endpointUrl }),
  });
  const fixture = redactClientBundle(await readBundle(client, config));
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const output = new URL(`lcu-postgame-${config.name}.json`, OUTPUT_DIRECTORY);
  await Bun.write(output, `${JSON.stringify(fixture, null, 2)}\n`);
  // The repository formats committed JSON with Prettier.
  const prettier = Bun.spawn(["bunx", "prettier", "--write", output.pathname]);
  if ((await prettier.exited) !== 0) {
    throw new Error(`prettier failed on ${output.pathname}`);
  }
  await Bun.stdout.write(`Wrote ${output.pathname}\n`);
}

if (import.meta.main) {
  await main();
}

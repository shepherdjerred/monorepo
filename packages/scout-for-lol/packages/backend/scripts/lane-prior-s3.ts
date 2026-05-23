import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index.ts";

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LanePriorS3ConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  startDate: DateOnlySchema,
  endDate: DateOnlySchema,
  queueIds: z.array(z.number().int().positive()).min(1),
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.url().optional(),
});

export type LanePriorS3Config = z.infer<typeof LanePriorS3ConfigSchema>;

export function lanePriorS3Region(): string {
  const region = Bun.env["AWS_REGION"] ?? Bun.env["S3_REGION"];
  if (region === undefined || region.trim() === "") {
    return "us-east-1";
  }
  return region;
}

function dateToPrefix(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `games/${year}/${month}/${day}/`;
}

function parseDateOnly(date: string): Date {
  const parsed = DateOnlySchema.parse(date);
  return new Date(`${parsed}T00:00:00.000Z`);
}

function datePrefixes(startDate: string, endDate: string): string[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start.getTime() > end.getTime()) {
    throw new Error(`startDate ${startDate} is after endDate ${endDate}`);
  }
  const prefixes: string[] = [];
  for (
    let cursor = new Date(start);
    cursor.getTime() <= end.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    prefixes.push(dateToPrefix(cursor));
  }
  return prefixes;
}

function createClient(config: LanePriorS3Config): S3Client {
  if (config.awsProfile !== undefined) {
    Bun.env["AWS_PROFILE"] = config.awsProfile;
    Bun.env["AWS_SDK_LOAD_CONFIG"] = "1";
  }
  return new S3Client({
    forcePathStyle: true,
    region: lanePriorS3Region(),
    ...(config.endpointUrl === undefined
      ? {}
      : { endpoint: config.endpointUrl }),
  });
}

async function listMatchKeysForPrefix(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command =
      continuationToken === undefined
        ? new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
        : new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          });
    const response = await client.send(command);
    for (const object of response.Contents ?? []) {
      if (object.Key?.endsWith("/match.json") === true) {
        keys.push(object.Key);
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken !== undefined);

  return keys;
}

async function fetchMatch(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<RawMatch> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.Body === undefined) {
    throw new Error(`S3 object ${key} has no body`);
  }
  const text = await response.Body.transformToString();
  const raw: unknown = JSON.parse(text);
  return RawMatchSchema.parse(raw);
}

function queueFiltered(match: RawMatch, queueIds: readonly number[]): boolean {
  return queueIds.includes(match.info.queueId);
}

export async function listLanePriorMatchKeys(
  rawConfig: LanePriorS3Config,
): Promise<string[]> {
  const config = LanePriorS3ConfigSchema.parse(rawConfig);
  const client = createClient(config);
  const keys: string[] = [];

  for (const prefix of datePrefixes(config.startDate, config.endDate)) {
    keys.push(...(await listMatchKeysForPrefix(client, config.bucket, prefix)));
  }

  return keys.toSorted();
}

export async function fetchLanePriorMatches(
  rawConfig: LanePriorS3Config,
  keys: readonly string[],
): Promise<RawMatch[]> {
  const config = LanePriorS3ConfigSchema.parse(rawConfig);
  const client = createClient(config);
  const matches: RawMatch[] = [];

  for (const key of keys) {
    const match = await fetchMatch(client, config.bucket, key);
    if (queueFiltered(match, config.queueIds)) {
      matches.push(match);
    }
  }

  return matches;
}

export function deterministicSampleKeys(input: {
  keys: readonly string[];
  sampleSize: number;
  seed: string;
}): string[] {
  if (input.sampleSize <= 0) {
    throw new Error("sampleSize must be positive");
  }
  return input.keys
    .map((key) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(`${input.seed}:${key}`);
      return { key, hash: hasher.digest("hex") };
    })
    .toSorted((left, right) => left.hash.localeCompare(right.hash))
    .slice(0, input.sampleSize)
    .map((entry) => entry.key);
}

export function deterministicSampleMatches(input: {
  matches: readonly RawMatch[];
  sampleSize: number;
  seed: string;
}): RawMatch[] {
  if (input.sampleSize <= 0) {
    throw new Error("sampleSize must be positive");
  }
  if (input.matches.length < input.sampleSize) {
    throw new Error(
      `Requested ${input.sampleSize.toString()} holdout matches but only ${input.matches.length.toString()} eligible matches were available`,
    );
  }
  return input.matches
    .map((match) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(`${input.seed}:${match.metadata.matchId}`);
      return { match, hash: hasher.digest("hex") };
    })
    .toSorted((left, right) => left.hash.localeCompare(right.hash))
    .slice(0, input.sampleSize)
    .map((entry) => entry.match);
}

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index.ts";
import { lanePriorS3Region } from "./lane-prior-s3.ts";

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const QueueActivityS3ConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  startDate: DateOnlySchema,
  endDate: DateOnlySchema,
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.url().optional(),
});

export type QueueActivityS3Config = z.infer<typeof QueueActivityS3ConfigSchema>;

/** raw queueId string → `YYYY-MM-DD` (UTC game date) → match count. */
export type QueueActivityCounts = Record<string, Record<string, number>>;

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

function createClient(config: QueueActivityS3Config): S3Client {
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

/** UTC calendar date a match was played, from its game start timestamp. */
export function matchDateString(match: RawMatch): string {
  return new Date(match.info.gameStartTimestamp).toISOString().slice(0, 10);
}

/**
 * Pure aggregation of RawMatch records into per-queue, per-day counts. Split
 * from the S3 walk so it can be unit-tested against fixtures with no live S3.
 */
export function aggregateQueueActivity(
  matches: readonly RawMatch[],
): QueueActivityCounts {
  const counts: QueueActivityCounts = {};
  for (const match of matches) {
    // Custom lobbies reuse queue ids from real modes (observed: queueId 3130
    // with gameType CUSTOM_GAME) — they say nothing about a mode being live,
    // so they must not feed availability windows.
    if (match.info.gameType.toUpperCase().startsWith("CUSTOM")) {
      continue;
    }
    const queueId = match.info.queueId.toString();
    const date = matchDateString(match);
    const byDate = counts[queueId] ?? {};
    byDate[date] = (byDate[date] ?? 0) + 1;
    counts[queueId] = byDate;
  }
  return counts;
}

/**
 * Walk the `games/YYYY/MM/DD/**` partitions across a date range and count every
 * match by its raw queue id and UTC game date. No queue filtering — the drift
 * engine needs the full picture (including unmapped queue ids).
 */
export async function collectQueueActivity(
  rawConfig: QueueActivityS3Config,
): Promise<QueueActivityCounts> {
  const config = QueueActivityS3ConfigSchema.parse(rawConfig);
  const client = createClient(config);
  const matches: RawMatch[] = [];

  for (const prefix of datePrefixes(config.startDate, config.endDate)) {
    const keys = await listMatchKeysForPrefix(client, config.bucket, prefix);
    for (const key of keys) {
      matches.push(await fetchMatch(client, config.bucket, key));
    }
  }

  return aggregateQueueActivity(matches);
}

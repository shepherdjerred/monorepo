import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index.ts";
import { z } from "zod";

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RawMatchS3ConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  startDate: DateOnlySchema,
  endDate: DateOnlySchema,
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.url().optional(),
});

export type RawMatchS3Config = z.infer<typeof RawMatchS3ConfigSchema>;

export function rawMatchS3Region(): string {
  const awsRegion = Bun.env["AWS_REGION"]?.trim();
  if (awsRegion !== undefined && awsRegion !== "") {
    return awsRegion;
  }

  const s3Region = Bun.env["S3_REGION"]?.trim();
  if (s3Region !== undefined && s3Region !== "") {
    return s3Region;
  }

  return "us-east-1";
}

function dateToPrefix(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `games/${year}/${month}/${day}/`;
}

function datePrefixes(startDate: string, endDate: string): string[] {
  const start = new Date(`${DateOnlySchema.parse(startDate)}T00:00:00.000Z`);
  const end = new Date(`${DateOnlySchema.parse(endDate)}T00:00:00.000Z`);
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

function createClient(config: RawMatchS3Config): S3Client {
  if (config.awsProfile !== undefined) {
    Bun.env["AWS_PROFILE"] = config.awsProfile;
    Bun.env["AWS_SDK_LOAD_CONFIG"] = "1";
  }
  return new S3Client({
    forcePathStyle: true,
    region: rawMatchS3Region(),
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
  const raw: unknown = JSON.parse(await response.Body.transformToString());
  return RawMatchSchema.parse(raw);
}

export function createRawMatchS3Source(rawConfig: RawMatchS3Config) {
  const config = RawMatchS3ConfigSchema.parse(rawConfig);
  const client = createClient(config);

  async function listMatchKeys(): Promise<string[]> {
    const keys: string[] = [];
    for (const prefix of datePrefixes(config.startDate, config.endDate)) {
      keys.push(
        ...(await listMatchKeysForPrefix(client, config.bucket, prefix)),
      );
    }
    return keys;
  }

  async function fetchRawMatch(key: string): Promise<RawMatch> {
    return fetchMatch(client, config.bucket, key);
  }

  async function visitMatches(
    visitor: (match: RawMatch) => Promise<void> | void,
  ): Promise<void> {
    for (const prefix of datePrefixes(config.startDate, config.endDate)) {
      const keys = await listMatchKeysForPrefix(client, config.bucket, prefix);
      for (const key of keys) {
        await visitor(await fetchRawMatch(key));
      }
    }
  }

  return { listMatchKeys, fetchMatch: fetchRawMatch, visitMatches };
}

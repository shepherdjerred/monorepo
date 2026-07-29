import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  RawMatchSchema,
  RawTimelineSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";

const MATCH_KEY_PATTERN = /^games\/\d{4}\/\d{2}\/\d{2}\/.+\/match\.json$/;

export type RawMatchPair = {
  rawMatch: RawMatch;
  rawTimeline: RawTimeline;
  matchText: string;
  timelineText: string;
};

export function createS3Client(): S3Client {
  return new S3Client({ forcePathStyle: true });
}

async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.Body === undefined)
    throw new Error(`S3 object has no body: ${key}`);
  return response.Body.transformToString();
}

export async function fetchRawMatchPair(
  client: S3Client,
  bucket: string,
  matchKey: string,
  timelineKey: string,
): Promise<RawMatchPair> {
  const [matchText, timelineText] = await Promise.all([
    readObject(client, bucket, matchKey),
    readObject(client, bucket, timelineKey),
  ]);
  const rawMatchJson: unknown = JSON.parse(matchText);
  const rawTimelineJson: unknown = JSON.parse(timelineText);
  return {
    matchText,
    timelineText,
    rawMatch: RawMatchSchema.parse(rawMatchJson),
    rawTimeline: RawTimelineSchema.parse(rawTimelineJson),
  };
}

export async function fetchRawMatch(
  client: S3Client,
  bucket: string,
  matchKey: string,
): Promise<RawMatch> {
  const matchText = await readObject(client, bucket, matchKey);
  const rawMatchJson: unknown = JSON.parse(matchText);
  return RawMatchSchema.parse(rawMatchJson);
}

export async function listCandidateMatchKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key !== undefined && MATCH_KEY_PATTERN.test(object.Key)) {
        keys.push(object.Key);
      }
    }
    continuationToken =
      response.IsTruncated === true
        ? response.NextContinuationToken
        : undefined;
    if (response.IsTruncated === true && continuationToken === undefined) {
      throw new Error(
        "S3 truncated candidate listing without a continuation token",
      );
    }
  } while (continuationToken !== undefined);
  return keys.toSorted();
}

export function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

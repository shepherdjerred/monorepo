import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { format } from "date-fns";
import { z } from "zod";
import { getErrorMessage } from "#src/utils/errors.ts";

/**
 * Shared read/enumerate helpers for the S3 raw-object store (SeaweedFS,
 * in-cluster). S3 is the canonical store of raw match/prematch/timeline JSON;
 * the report-lake compactor rebuilds from here, and the backfill/parity scripts
 * reconcile SQLite against here. Object layout (mirrors storage/s3-helpers.ts +
 * storage/s3-prematch.ts exactly):
 *
 *   games/{yyyy}/{MM}/{dd}/{matchId}/match.json
 *   games/{yyyy}/{MM}/{dd}/{matchId}/timeline.json
 *   prematch/{yyyy}/{MM}/{dd}/{gameId}/spectator-data.json
 */

export const MATCH_PREFIX = "games/";
export const PREMATCH_PREFIX = "prematch/";

export type RawObjectKind = "match" | "timeline" | "prematch" | "ignored";

export function classifyRawObjectKey(key: string): RawObjectKind {
  if (key.startsWith(MATCH_PREFIX) && key.endsWith("/match.json")) {
    return "match";
  }
  if (key.startsWith(MATCH_PREFIX) && key.endsWith("/timeline.json")) {
    return "timeline";
  }
  if (key.startsWith(PREMATCH_PREFIX) && key.endsWith("/spectator-data.json")) {
    return "prematch";
  }
  return "ignored";
}

// --- Deterministic key builders (must match storage/s3-helpers.ts +
// storage/s3-prematch.ts byte-for-byte). `keyDate` is the same value the live
// write path uses: match = gameCreation; timeline + prematch = upload time. ---

function datePath(keyDate: Date): string {
  return format(keyDate, "yyyy/MM/dd");
}

export function matchObjectKey(matchId: string, keyDate: Date): string {
  return `${MATCH_PREFIX}${datePath(keyDate)}/${matchId}/match.json`;
}

export function timelineObjectKey(matchId: string, keyDate: Date): string {
  return `${MATCH_PREFIX}${datePath(keyDate)}/${matchId}/timeline.json`;
}

export function prematchObjectKey(gameId: string, keyDate: Date): string {
  return `${PREMATCH_PREFIX}${datePath(keyDate)}/${gameId}/spectator-data.json`;
}

export type RawObjectRef = {
  key: string;
  lastModified: Date | undefined;
};

/**
 * Fully enumerate a prefix via ContinuationToken (MaxKeys 1000), yielding every
 * object. Unlike the legacy importer's batched StartAfter loop this is
 * exhaustive — safe to drive a full-history lake rebuild.
 */
export async function* enumerateRawObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
): AsyncGenerator<RawObjectRef> {
  let continuationToken: string | undefined = undefined;
  do {
    const response: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key === undefined) {
        continue;
      }
      yield { key: object.Key, lastModified: object.LastModified };
    }
    continuationToken =
      response.IsTruncated === true
        ? response.NextContinuationToken
        : undefined;
  } while (continuationToken !== undefined);
}

export async function readRawObjectText(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (response.Body === undefined) {
    throw new Error(`S3 object has no body: ${key}`);
  }
  return await response.Body.transformToString();
}

// A missing object surfaces as a NotFound / 404 error from HeadObject; anything
// else (auth, network) must propagate. Narrow the error shape with Zod rather
// than a type assertion (repo rule).
const S3ErrorShapeSchema = z.object({
  name: z.string().optional(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

function isNotFoundError(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  return (
    parsed.data.name === "NotFound" ||
    parsed.data.name === "NoSuchKey" ||
    parsed.data.$metadata?.httpStatusCode === 404
  );
}

export async function rawObjectExists(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw new Error(`HeadObject failed for ${key}: ${getErrorMessage(error)}`, {
      cause: error,
    });
  }
}

export async function putRawJsonObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: new TextEncoder().encode(body),
      ContentType: "application/json",
    }),
  );
}

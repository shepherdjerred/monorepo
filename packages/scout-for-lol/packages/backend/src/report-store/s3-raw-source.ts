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
import { computeSha256Digest } from "#src/storage/object-integrity.ts";

/**
 * Shared read/enumerate helpers for the S3 raw-object store (SeaweedFS,
 * in-cluster). S3 is the canonical store of raw match/prematch/timeline JSON;
 * the report-lake compactor rebuilds from here, and the backfill/parity scripts
 * reconcile SQLite against here. Object layout (mirrors storage/s3-helpers.ts +
 * storage/s3-prematch.ts exactly):
 *
 *   games/{yyyy}/{MM}/{dd}/{matchId}/match.json
 *   games/{yyyy}/{MM}/{dd}/{matchId}/timeline.json
 *   prematch/{yyyy}/{MM}/{dd}/{platformId}_{gameId}/spectator-data.json
 *   prematch/{yyyy}/{MM}/{dd}/{gameId}/spectator-data.json   (pre-qualification)
 *
 * Prematch objects have two spellings. Objects written before the key was
 * platform-qualified sit under the bare numeric game id; everything since
 * sits under `{platformId}_{gameId}` (see `storage/s3-prematch.ts`). Every
 * reader here decides by prefix and suffix, never by the shape of the identity
 * segment, so both spellings are read alike — and a prematch object's identity
 * always comes from its parsed payload, never from its key.
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
  return key.startsWith(PREMATCH_PREFIX) && key.endsWith("/spectator-data.json")
    ? "prematch"
    : "ignored";
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

/** The current spelling; `resourceId` is `storage/s3-prematch.ts`'s. */
export function prematchObjectKey(resourceId: string, keyDate: Date): string {
  return `${PREMATCH_PREFIX}${datePath(keyDate)}/${resourceId}/spectator-data.json`;
}

export type RawObjectRef = {
  key: string;
  lastModified: Date | undefined;
};

type S3ReadOptions = {
  abortSignal?: AbortSignal;
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
  options: S3ReadOptions = {},
): AsyncGenerator<RawObjectRef> {
  let continuationToken: string | undefined;
  do {
    const response: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
      options.abortSignal === undefined
        ? {}
        : { abortSignal: options.abortSignal },
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
  options: S3ReadOptions = {},
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    options.abortSignal === undefined
      ? {}
      : { abortSignal: options.abortSignal },
  );
  if (response.Body === undefined) {
    throw new Error(`S3 object has no body: ${key}`);
  }
  return await response.Body.transformToString();
}

async function readRawObjectBytes(
  client: S3Client,
  bucket: string,
  key: string,
  options: S3ReadOptions = {},
): Promise<Uint8Array> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    options.abortSignal === undefined
      ? {}
      : { abortSignal: options.abortSignal },
  );
  if (response.Body === undefined) {
    throw new Error(`S3 object has no body: ${key}`);
  }
  return await response.Body.transformToByteArray();
}

/**
 * The archived object cannot serve as the snapshot its receipt attests, and no
 * retry will change that.
 *
 * Exactly three ways to earn this: the object is gone, its bytes do not match
 * the digest that was recorded for them, or they do not parse as the payload
 * they claim to be. Every one is a fact about what is stored. A transport
 * failure is deliberately NOT one of them — it is the absence of an answer —
 * and callers distinguish the two by this type rather than by inspecting
 * errors themselves.
 */
export class ArchivedObjectUnusableError extends Error {
  readonly reason: "missing" | "digest-mismatch" | "unparseable";
  readonly key: string;

  constructor(args: {
    key: string;
    reason: "missing" | "digest-mismatch" | "unparseable";
    detail: string;
  }) {
    super(
      `Archived object ${args.key} is unusable (${args.reason}): ${args.detail}`,
    );
    this.name = "ArchivedObjectUnusableError";
    this.reason = args.reason;
    this.key = args.key;
  }
}

/**
 * Read an archived object back and prove it is the one the caller means.
 *
 * The write path records a SHA-256 content address precisely so a later reader
 * can check it, and this is the read that cashes that in. It matters for any
 * caller that RESUMES from an archive rather than from a live source: it is
 * about to treat these bytes as the canonical payload, and an object that has
 * been overwritten, truncated or replaced since the receipt was written is not
 * that payload. Silently using it would let a resumed run stage rows and mint
 * notifications from content nothing attested to.
 *
 * The digest is taken over exactly what `putContentAddressedObject` hashed on
 * the way in: the stored bytes for a binary object, the UTF-8 encoding for a
 * text one. The two readers below differ only in how the body is pulled off
 * the response; the verification is one rule.
 */
type VerifiedReadArgs = {
  client: S3Client;
  bucket: string;
  key: string;
  expectedDigest: string;
  options?: S3ReadOptions;
};

async function readVerified<Value>(
  args: VerifiedReadArgs,
  read: () => Promise<Value>,
  bytesOf: (value: Value) => Uint8Array,
): Promise<Value> {
  let value: Value;
  try {
    value = await read();
  } catch (error) {
    // The same distinction the spectator boundary draws, on the read side. A
    // missing object is a fact about storage that no retry can change; a
    // timeout, a 5xx or a dropped connection establishes nothing at all about
    // whether the object is there, so it propagates untouched and stays
    // retryable for whoever owns the retry.
    if (isNotFoundError(error)) {
      throw new ArchivedObjectUnusableError({
        key: args.key,
        reason: "missing",
        detail: "no object exists at that key",
      });
    }
    throw error;
  }
  const digest = computeSha256Digest(bytesOf(value));
  if (digest !== args.expectedDigest) {
    throw new ArchivedObjectUnusableError({
      key: args.key,
      reason: "digest-mismatch",
      detail: `expected ${args.expectedDigest}, read ${digest}`,
    });
  }
  return value;
}

export async function readVerifiedRawObjectBytes(
  args: VerifiedReadArgs,
): Promise<Uint8Array> {
  return await readVerified(
    args,
    () =>
      readRawObjectBytes(
        args.client,
        args.bucket,
        args.key,
        args.options ?? {},
      ),
    (bytes) => bytes,
  );
}

export async function readVerifiedRawObjectText(
  args: VerifiedReadArgs,
): Promise<string> {
  return await readVerified(
    args,
    () =>
      readRawObjectText(args.client, args.bucket, args.key, args.options ?? {}),
    (text) => new TextEncoder().encode(text),
  );
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
  return (
    parsed.success &&
    (parsed.data.name === "NotFound" ||
      parsed.data.name === "NoSuchKey" ||
      parsed.data.$metadata?.httpStatusCode === 404)
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

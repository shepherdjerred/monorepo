import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  IsoInstantSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type IsoInstant,
  type S3ObjectKey,
  type Sha256Digest,
} from "@scout-for-lol/domain/identity/brands.ts";
import { createLogger } from "#src/logger.ts";
import { sendPutWithRetry } from "#src/storage/s3-put-retry.ts";
import { validateS3Metadata } from "#src/storage/s3-metadata.ts";

const logger = createLogger("storage-object-integrity");

/**
 * Content addressing for raw archive objects.
 *
 * Every raw match/timeline/prematch payload is hashed before it is uploaded,
 * the digest travels with the object as user metadata, and the same digest is
 * handed back to the caller as part of the artifact descriptor. That makes a
 * stored object verifiable later — a reader can re-hash the body it fetched and
 * compare — without a read-back GET on the write path.
 *
 * WHAT THE WRITE PATH VERIFIES, EXACTLY:
 *
 * - VERIFIED by the SDK, not by us: transit integrity. @aws-sdk/client-s3 sends
 *   a request checksum the server recomputes and rejects on mismatch, so a
 *   corrupted or truncated body fails the put itself. That is the primary
 *   guarantee, and it is why nothing here re-reads the object.
 * - VERIFIED here, as confirmation: that the body the server acknowledged is
 *   the body we sent. A single-part PutObject returns an ETag that is the MD5
 *   of the stored body, so comparing it against the MD5 we computed locally
 *   independently confirms the SDK's checksum. SeaweedFS follows S3 here for
 *   single-part puts.
 * - NOT VERIFIED: that the object is still intact at read time, that it was
 *   durably replicated, or that a later overwrite preserved the content. Those
 *   are read-time and storage-layer properties; the recorded digest is what
 *   makes them checkable, not the write.
 * - NOT VERIFIED: multipart uploads. A multipart ETag is a digest of part
 *   digests plus a `-N` suffix, not the body's MD5, so it cannot be compared.
 *   The archive path only issues single-part puts, but the check degrades to a
 *   skip rather than a false alarm if that ever changes.
 * - NOT DONE AT ALL: a read-back GET per write. It would double the request
 *   volume on the ingest hot path to re-prove what the checksum already proved.
 *
 * MD5 is used only because it is the algorithm S3 defines for the ETag. The
 * content address recorded in the descriptor and the receipt is SHA-256.
 */

/** The S3 user-metadata key carrying an object's SHA-256 content address. */
export const SHA256_METADATA_KEY = "sha256";

export function computeSha256Digest(body: Uint8Array): Sha256Digest {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(body);
  return Sha256DigestSchema.parse(hasher.digest("hex"));
}

function computeMd5Hex(body: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(body);
  return hasher.digest("hex");
}

export type EtagVerification =
  | { outcome: "verified" }
  | { outcome: "skipped"; reason: "no-etag" | "multipart-etag" }
  | { outcome: "mismatch"; expectedMd5: string; returnedEtag: string };

/**
 * Compare a PutObject's returned ETag against the MD5 of the body we uploaded.
 *
 * A missing ETag or a multipart ETag is a skip, not a failure: neither is
 * evidence that the bytes differ. Only a well-formed single-part ETag that
 * disagrees with our own MD5 is a mismatch, and that is a genuine integrity
 * failure the caller must not paper over.
 */
export function verifyPutEtag(args: {
  body: Uint8Array;
  etag: string | undefined;
}): EtagVerification {
  if (args.etag === undefined) {
    return { outcome: "skipped", reason: "no-etag" };
  }
  const normalized = args.etag.replaceAll('"', "");
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return { outcome: "skipped", reason: "multipart-etag" };
  }
  const expectedMd5 = computeMd5Hex(args.body);
  return normalized === expectedMd5
    ? { outcome: "verified" }
    : { outcome: "mismatch", expectedMd5, returnedEtag: normalized };
}

/**
 * Fail the upload when the server acknowledged different bytes than we sent.
 *
 * A mismatch is not a transient condition to retry past: the object under that
 * key is not the payload the caller believes it archived, and S3 is the
 * canonical raw store. Throwing here means the ingest path treats it exactly
 * like a failed put — no receipt, no cursor advance — instead of recording a
 * digest that describes bytes nobody has.
 */
export function assertPutIntegrity(args: {
  body: Uint8Array;
  etag: string | undefined;
  errorContext: string;
  key: string;
}): void {
  const verification = verifyPutEtag({ body: args.body, etag: args.etag });
  if (verification.outcome === "mismatch") {
    throw new Error(
      `S3 stored a different body than we uploaded for ${args.errorContext} at ${args.key}: ` +
        `expected MD5 ${verification.expectedMd5}, server returned ETag ${verification.returnedEtag}`,
    );
  }
  if (verification.outcome === "skipped") {
    logger.debug(
      `[S3Storage] ETag integrity check skipped for ${args.key} (${verification.reason})`,
    );
  }
}

/**
 * What one completed PutObject actually stored.
 *
 * This is the artifact descriptor minus its `kind`: the caller knows whether it
 * archived a match, a timeline or a prematch snapshot, and the put does not.
 * `key` is the key that was really written, not a recomputed one, so a
 * descriptor built from this can never describe an object that is not there.
 */
export type StoredObject = {
  key: S3ObjectKey;
  digest: Sha256Digest;
  bytes: number;
  contentType: string;
  capturedAt: IsoInstant;
  url: string;
};

/**
 * Content-address a body, PUT it, confirm what came back, and describe it.
 *
 * The match-keyed and prematch-keyed writers differ only in how they build a key
 * and what they log. Everything from "encode the body" to "return a descriptor"
 * is one procedure, and it lives here so the digest, the metadata key, the retry
 * and the integrity check cannot drift apart between the two.
 */
export async function putContentAddressedObject(args: {
  client: S3Client;
  bucket: string;
  key: string;
  body: string | Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
  errorContext: string;
  retryContext: string;
  logDetails?: Record<string, unknown>;
}): Promise<StoredObject> {
  const StringSchema = z.string();
  const BytesSchema = z.instanceof(Uint8Array);

  // Try to validate as string first, then bytes.
  const stringResult = StringSchema.safeParse(args.body);
  const bodyBuffer: Uint8Array = stringResult.success
    ? new TextEncoder().encode(stringResult.data)
    : BytesSchema.parse(args.body);
  const sizeBytes = bodyBuffer.length;
  const digest = computeSha256Digest(bodyBuffer);

  logger.info(`[S3Storage] 📝 Upload details:`, {
    bucket: args.bucket,
    key: args.key,
    sizeBytes,
    digest,
    ...args.logDetails,
  });

  const capturedAt = new Date().toISOString();
  const command = new PutObjectCommand({
    Bucket: args.bucket,
    Key: args.key,
    Body: bodyBuffer,
    ContentType: args.contentType,
    Metadata: validateS3Metadata({
      ...args.metadata,
      [SHA256_METADATA_KEY]: digest,
      uploadedAt: capturedAt,
    }),
  });

  const output = await sendPutWithRetry(
    args.client,
    command,
    args.retryContext,
  );
  assertPutIntegrity({
    body: bodyBuffer,
    etag: output.ETag,
    errorContext: args.errorContext,
    key: args.key,
  });

  return {
    key: S3ObjectKeySchema.parse(args.key),
    digest,
    bytes: sizeBytes,
    contentType: args.contentType,
    capturedAt: IsoInstantSchema.parse(capturedAt),
    url: `s3://${args.bucket}/${args.key}`,
  };
}

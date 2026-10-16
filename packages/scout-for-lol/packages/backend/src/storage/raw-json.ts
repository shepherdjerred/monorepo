import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import { assertPutIntegrity, computeSha256Digest } from "./object-integrity.ts";

/** Content-addressed immutable writes share the same uncertain-write verification. */
export async function putImmutableRawJson(
  client: S3Client,
  bucket: string,
  object: { key: string; digest: string; bytes: Uint8Array },
  source: string,
): Promise<void> {
  const abortSignal = AbortSignal.timeout(10_000);
  try {
    const stored = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: object.key,
        Body: object.bytes,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Metadata: { sha256: object.digest, source, archiveversion: "1" },
      }),
      { abortSignal },
    );
    assertPutIntegrity({
      body: object.bytes,
      etag: stored.ETag,
      errorContext: "raw evidence",
      key: object.key,
    });
  } catch (error) {
    if (
      !(error instanceof S3ServiceException) ||
      error.$metadata.httpStatusCode !== 412
    )
      throw error;
    const stored = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: object.key }),
      { abortSignal },
    );
    if (
      stored.Body === undefined ||
      stored.ContentLength !== object.bytes.length ||
      computeSha256Digest(await stored.Body.transformToByteArray()) !==
        object.digest
    )
      throw new Error("Stored raw evidence failed integrity verification", {
        cause: error,
      });
  }
}

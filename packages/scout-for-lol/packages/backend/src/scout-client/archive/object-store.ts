import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  assertPutIntegrity,
  computeSha256Digest,
} from "#src/storage/object-integrity.ts";
import { rawObservationObject } from "./envelope.ts";
import type { ScoutClientObservation } from "#generated/prisma/client/index.js";

export async function putRawObservation(
  client: S3Client,
  bucket: string,
  object: ReturnType<typeof rawObservationObject>,
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
        Metadata: {
          sha256: object.digest,
          source: "scout-client",
          archiveversion: "1",
        },
      }),
      { abortSignal },
    );
    assertPutIntegrity({
      body: object.bytes,
      etag: stored.ETag,
      errorContext: "client observation",
      key: object.key,
    });
  } catch (error) {
    if (
      !(error instanceof S3ServiceException) ||
      error.$metadata.httpStatusCode !== 412
    )
      throw error;
    // A prior put may have succeeded before the DB checkpoint. Verify those bytes.
    const stored = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: object.key }),
      { abortSignal },
    );
    if (
      stored.Body === undefined ||
      stored.ContentLength !== object.bytes.length ||
      computeSha256Digest(await stored.Body.transformToByteArray()) !==
        object.digest
    ) {
      throw new Error(
        "Stored client observation failed integrity verification",
        { cause: error },
      );
    }
  }
}

export async function persistRawObservation(row: ScoutClientObservation) {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined)
    throw new Error("Raw client archival requires an object-store bucket");
  const object = rawObservationObject(row);
  const client = createS3Client();
  try {
    await putRawObservation(client, bucket, object);
    return {
      key: object.key,
      digest: object.digest,
      bytes: BigInt(object.bytes.length),
    };
  } finally {
    client.destroy();
  }
}

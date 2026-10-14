import type { S3Client } from "@aws-sdk/client-s3";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { putImmutableRawJson } from "#src/storage/raw-json.ts";
import { rawObservationObject } from "./envelope.ts";
import type { ScoutClientObservation } from "#generated/prisma/client/index.js";

export async function putRawObservation(
  client: S3Client,
  bucket: string,
  object: ReturnType<typeof rawObservationObject>,
): Promise<void> {
  await putImmutableRawJson(client, bucket, object, "scout-client");
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

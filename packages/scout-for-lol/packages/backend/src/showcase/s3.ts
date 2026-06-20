import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

type ReadS3ObjectParams = {
  client: S3Client;
  bucket: string;
  key: string;
};

async function readS3Body(params: ReadS3ObjectParams) {
  const response = await params.client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );

  if (response.Body === undefined) {
    throw new Error(
      `S3 object has no body: s3://${params.bucket}/${params.key}`,
    );
  }

  return response.Body;
}

export async function readS3ObjectBytes(
  params: ReadS3ObjectParams,
): Promise<Uint8Array> {
  const body = await readS3Body(params);
  return await body.transformToByteArray();
}

export async function readS3ObjectText(
  params: ReadS3ObjectParams,
): Promise<string> {
  const body = await readS3Body(params);
  return await body.transformToString();
}

export async function readS3Json(params: ReadS3ObjectParams): Promise<unknown> {
  const text = await readS3ObjectText(params);
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** True for an S3 "object not found" error (NoSuchKey / 404). */
export function isMissingS3Object(error: unknown): boolean {
  return error instanceof Error && error.name === "NoSuchKey";
}

/**
 * Like {@link readS3Json}, but returns `undefined` when the key doesn't exist.
 * Recent matches can have their report image uploaded before the match.json,
 * so callers tolerate a missing payload rather than fail the whole gallery.
 */
export async function readS3JsonOptional(
  params: ReadS3ObjectParams,
): Promise<unknown> {
  try {
    return await readS3Json(params);
  } catch (error) {
    if (isMissingS3Object(error)) {
      return undefined;
    }
    throw error;
  }
}

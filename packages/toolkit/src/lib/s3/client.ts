import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Thin wrapper over the AWS SDK S3 client for SeaweedFS uploads. Credentials,
 * endpoint (`endpoint_url`), and region are resolved entirely by the standard
 * AWS toolchain — `~/.aws/credentials` / `~/.aws/config` profiles and the
 * `AWS_*` environment variables — exactly as the AWS CLI does. Path-style
 * addressing (`forcePathStyle`) is mandatory for SeaweedFS.
 */

/**
 * Construct an S3 client for the given AWS profile. When `profile` is omitted
 * the SDK falls back to its standard resolution (`AWS_PROFILE` or `default`).
 */
export function createS3Client(profile?: string, endpoint?: string): S3Client {
  return new S3Client({
    forcePathStyle: true, // SeaweedFS requires path-style addressing
    ...(profile != null && profile.length > 0 ? { profile } : {}),
    ...(endpoint === undefined ? {} : { endpoint, region: "auto" }),
  });
}

export type PutObjectParams = {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
};

/** Upload a single object. The SDK signs the request via SigV4. */
export async function putObject(
  client: S3Client,
  params: PutObjectParams,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}

/**
 * Read a single object as text with its user metadata. A missing body is an
 * error, never an empty object.
 */
export async function getObjectText(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<{ text: string; metadata: Record<string, string> }> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
  );
  if (response.Body === undefined)
    throw new Error(`s3://${params.bucket}/${params.key} returned no body`);
  return {
    text: await response.Body.transformToString(),
    metadata: response.Metadata ?? {},
  };
}

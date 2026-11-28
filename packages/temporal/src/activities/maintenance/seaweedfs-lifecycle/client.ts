import {
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { LifecycleS3 } from "./core.ts";

type Sender = Pick<S3Client, "send">;

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the SeaweedFS lifecycle sweep`);
  }
  return value;
}

function isMissingLifecycle(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    error.name === "NoSuchLifecycleConfiguration"
  );
}

/** The SeaweedFS S3 operations the sweep uses, over an AWS SDK sender. */
export function lifecycleS3FromSender(client: Sender): LifecycleS3 {
  return {
    async listBuckets() {
      const response = await client.send(new ListBucketsCommand({}));
      return (response.Buckets ?? []).flatMap((bucket) =>
        bucket.Name === undefined ? [] : [bucket.Name],
      );
    },
    async getLifecycleRules(bucket) {
      try {
        const response = await client.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
        );
        return response.Rules ?? [];
      } catch (error: unknown) {
        // Only the documented "no configuration" answer means "skip this
        // bucket"; any other failure must surface rather than hide a bucket.
        if (!isMissingLifecycle(error)) throw error;
        return;
      }
    },
    async listObjects({ bucket, prefix, token, maxKeys }) {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ...(prefix === "" ? {} : { Prefix: prefix }),
          ...(token === undefined ? {} : { ContinuationToken: token }),
          MaxKeys: maxKeys,
        }),
      );
      return {
        objects: (response.Contents ?? []).flatMap((object) =>
          object.Key === undefined
            ? []
            : [
                {
                  key: object.Key,
                  size: object.Size ?? 0,
                  lastModified: object.LastModified,
                },
              ],
        ),
        nextToken:
          response.IsTruncated === true
            ? response.NextContinuationToken
            : undefined,
      };
    },
    async deleteObjects({ bucket, keys }) {
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
      return (response.Errors ?? []).flatMap((error) =>
        error.Key === undefined
          ? []
          : [
              {
                key: error.Key,
                code: error.Code ?? "Unknown",
                message: error.Message ?? "",
              },
            ],
      );
    },
  };
}

function regionFrom(env: Readonly<Record<string, string | undefined>>): string {
  const region = env["S3_REGION"]?.trim();
  return region === undefined || region === "" ? "us-east-1" : region;
}

/**
 * The worker's shared first-party SeaweedFS identity (`S3_ENDPOINT`,
 * `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), path-style as SeaweedFS needs.
 */
export function createLifecycleS3(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): LifecycleS3 {
  return lifecycleS3FromSender(
    new S3Client({
      endpoint: requiredEnv(env, "S3_ENDPOINT"),
      region: regionFrom(env),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requiredEnv(env, "AWS_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv(env, "AWS_SECRET_ACCESS_KEY"),
      },
    }),
  );
}

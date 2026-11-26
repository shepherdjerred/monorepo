import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

/**
 * The handful of S3 operations the upload code needs, behind plain methods so
 * tests can pass a recording fake instead of the AWS SDK client.
 */

export type ObjectLocation = { bucket: string; key: string };

export type PutParams = ObjectLocation & {
  body: Uint8Array;
  contentType: string;
  cacheControl?: string | undefined;
};

export type CreateMultipartParams = ObjectLocation & {
  contentType: string;
  cacheControl?: string | undefined;
};

export type MultipartPart = { partNumber: number; etag: string | undefined };

export type ObjectStore = {
  put: (params: PutParams) => Promise<void>;
  /** Start a multipart upload and return its upload id. */
  createMultipart: (params: CreateMultipartParams) => Promise<string>;
  /** Upload one part and return its ETag. */
  uploadPart: (
    params: ObjectLocation & {
      uploadId: string;
      partNumber: number;
      body: Uint8Array;
    },
  ) => Promise<string | undefined>;
  completeMultipart: (
    params: ObjectLocation & { uploadId: string; parts: MultipartPart[] },
  ) => Promise<void>;
  abortMultipart: (
    params: ObjectLocation & { uploadId: string },
  ) => Promise<void>;
};

function cacheControlField(
  cacheControl: string | undefined,
): { CacheControl: string } | Record<string, never> {
  return cacheControl === undefined ? {} : { CacheControl: cacheControl };
}

/** Adapt an AWS SDK client to {@link ObjectStore}. */
export function s3ObjectStore(client: S3Client): ObjectStore {
  return {
    put: async (params) => {
      await client.send(
        new PutObjectCommand({
          Bucket: params.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
          ...cacheControlField(params.cacheControl),
        }),
      );
    },
    createMultipart: async (params) => {
      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: params.bucket,
          Key: params.key,
          ContentType: params.contentType,
          ...cacheControlField(params.cacheControl),
        }),
      );
      if (created.UploadId === undefined) {
        throw new Error(
          `S3 did not return an UploadId for multipart upload of '${params.key}'`,
        );
      }
      return created.UploadId;
    },
    uploadPart: async (params) => {
      const part = await client.send(
        new UploadPartCommand({
          Bucket: params.bucket,
          Key: params.key,
          UploadId: params.uploadId,
          PartNumber: params.partNumber,
          Body: params.body,
        }),
      );
      return part.ETag;
    },
    completeMultipart: async (params) => {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: params.bucket,
          Key: params.key,
          UploadId: params.uploadId,
          MultipartUpload: {
            Parts: params.parts.map((part) => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
        }),
      );
    },
    abortMultipart: async (params) => {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: params.bucket,
          Key: params.key,
          UploadId: params.uploadId,
        }),
      );
    },
  };
}

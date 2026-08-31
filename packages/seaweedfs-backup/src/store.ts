import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";
import {
  BackupEnvironmentSchema,
  RestoreEnvironmentSchema,
  type ObjectHeaders,
} from "./schemas.ts";

export type ListedObject = {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
};

export type StoredObject = ListedObject & {
  body: Readable;
  headers: ObjectHeaders;
};

export type PutObjectInput = {
  bucket: string;
  key: string;
  body: Readable | Uint8Array;
  contentLength?: number;
  headers: ObjectHeaders;
};

export type GetObjectConditions = {
  etag?: string;
  unmodifiedSince?: Date;
};

export type ObjectStore = {
  listBuckets: () => Promise<string[]>;
  listObjects: (bucket: string, prefix?: string) => Promise<ListedObject[]>;
  getObject: (
    bucket: string,
    key: string,
    conditions?: GetObjectConditions,
  ) => Promise<StoredObject>;
  headObject: (
    bucket: string,
    key: string,
  ) => Promise<ListedObject | undefined>;
  putObject: (input: PutObjectInput) => Promise<void>;
  deleteObject: (bucket: string, key: string) => Promise<void>;
};

function requiredString(
  value: string | undefined,
  description: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new TypeError(`S3 ${description} is missing`);
  }
  return value;
}

function bodyAsReadable(body: unknown, bucket: string, key: string): Readable {
  if (!(body instanceof Readable)) {
    throw new TypeError(
      `S3 returned a non-streaming body for ${bucket}/${key}`,
    );
  }
  return body;
}

function headersFromOutput(output: {
  CacheControl?: string | undefined;
  ContentDisposition?: string | undefined;
  ContentEncoding?: string | undefined;
  ContentLanguage?: string | undefined;
  ContentType?: string | undefined;
  Expires?: Date | undefined;
  Metadata?: Record<string, string> | undefined;
}): ObjectHeaders {
  return {
    ...(output.CacheControl === undefined
      ? {}
      : { cacheControl: output.CacheControl }),
    ...(output.ContentDisposition === undefined
      ? {}
      : { contentDisposition: output.ContentDisposition }),
    ...(output.ContentEncoding === undefined
      ? {}
      : { contentEncoding: output.ContentEncoding }),
    ...(output.ContentLanguage === undefined
      ? {}
      : { contentLanguage: output.ContentLanguage }),
    ...(output.ContentType === undefined
      ? {}
      : { contentType: output.ContentType }),
    ...(output.Expires === undefined
      ? {}
      : { expires: output.Expires.toISOString() }),
    metadata: output.Metadata ?? {},
  };
}

export class S3ObjectStore implements ObjectStore {
  public constructor(private readonly client: S3Client) {}

  public async listBuckets(): Promise<string[]> {
    const response = await this.client.send(new ListBucketsCommand({}));
    return (response.Buckets ?? []).map((bucket) =>
      requiredString(bucket.Name, "bucket name"),
    );
  }

  public async listObjects(
    bucket: string,
    prefix = "",
  ): Promise<ListedObject[]> {
    const objects: ListedObject[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(continuationToken === undefined
            ? {}
            : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of response.Contents ?? []) {
        objects.push({
          key: requiredString(object.Key, "object key"),
          size: object.Size ?? 0,
          etag: requiredString(object.ETag, "object ETag"),
          lastModified:
            object.LastModified ??
            (() => {
              throw new Error(
                `S3 object in ${bucket} has no modification time`,
              );
            })(),
        });
      }
      continuationToken =
        response.IsTruncated === true
          ? requiredString(response.NextContinuationToken, "continuation token")
          : undefined;
    } while (continuationToken !== undefined);
    return objects;
  }

  public async getObject(
    bucket: string,
    key: string,
    conditions: GetObjectConditions = {},
  ): Promise<StoredObject> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(conditions.etag === undefined ? {} : { IfMatch: conditions.etag }),
        ...(conditions.unmodifiedSince === undefined
          ? {}
          : { IfUnmodifiedSince: conditions.unmodifiedSince }),
      }),
    );
    return {
      key,
      size: response.ContentLength ?? 0,
      etag: requiredString(response.ETag, "object ETag"),
      lastModified:
        response.LastModified ??
        (() => {
          throw new Error(
            `S3 object ${bucket}/${key} has no modification time`,
          );
        })(),
      body: bodyAsReadable(response.Body, bucket, key),
      headers: headersFromOutput(response),
    };
  }

  public async headObject(
    bucket: string,
    key: string,
  ): Promise<ListedObject | undefined> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        key,
        size: response.ContentLength ?? 0,
        etag: requiredString(response.ETag, "object ETag"),
        lastModified:
          response.LastModified ??
          (() => {
            throw new Error(
              `S3 object ${bucket}/${key} has no modification time`,
            );
          })(),
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "NotFound" || error.name === "NoSuchKey")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  public async putObject(input: PutObjectInput): Promise<void> {
    const expires =
      input.headers.expires === undefined
        ? undefined
        : new Date(input.headers.expires);
    await new Upload({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ...(input.contentLength === undefined
          ? {}
          : { ContentLength: input.contentLength }),
        ...(input.headers.cacheControl === undefined
          ? {}
          : { CacheControl: input.headers.cacheControl }),
        ...(input.headers.contentDisposition === undefined
          ? {}
          : { ContentDisposition: input.headers.contentDisposition }),
        ...(input.headers.contentEncoding === undefined
          ? {}
          : { ContentEncoding: input.headers.contentEncoding }),
        ...(input.headers.contentLanguage === undefined
          ? {}
          : { ContentLanguage: input.headers.contentLanguage }),
        ...(input.headers.contentType === undefined
          ? {}
          : { ContentType: input.headers.contentType }),
        ...(expires === undefined ? {} : { Expires: expires }),
        Metadata: input.headers.metadata,
      },
    }).done();
  }

  public async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }
}

function createS3Client(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): S3Client {
  return new S3Client({
    endpoint: input.endpoint,
    region: input.region ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
}

export function createS3ObjectStore(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): ObjectStore {
  return new S3ObjectStore(createS3Client(input));
}

export function storesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): { source: ObjectStore; destination: ObjectStore; backupBucket: string } {
  const parsed = BackupEnvironmentSchema.parse(environment);
  return {
    source: createS3ObjectStore({
      endpoint: parsed.SEAWEEDFS_BACKUP_SOURCE_ENDPOINT,
      accessKeyId: parsed.SEAWEEDFS_BACKUP_SOURCE_ACCESS_KEY_ID,
      secretAccessKey: parsed.SEAWEEDFS_BACKUP_SOURCE_SECRET_ACCESS_KEY,
    }),
    destination: createS3ObjectStore({
      endpoint: parsed.R2_BACKUP_ENDPOINT,
      accessKeyId: parsed.R2_BACKUP_ACCESS_KEY_ID,
      secretAccessKey: parsed.R2_BACKUP_SECRET_ACCESS_KEY,
      region: "auto",
    }),
    backupBucket: parsed.R2_BACKUP_BUCKET,
  };
}

export function restoreStoreFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): ObjectStore {
  const parsed = RestoreEnvironmentSchema.parse(environment);
  return createS3ObjectStore({
    endpoint: parsed.SEAWEEDFS_RESTORE_ENDPOINT,
    accessKeyId: parsed.SEAWEEDFS_RESTORE_ACCESS_KEY_ID,
    secretAccessKey: parsed.SEAWEEDFS_RESTORE_SECRET_ACCESS_KEY,
  });
}

export async function readObjectBytes(
  object: StoredObject,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of object.body) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      throw new TypeError("Object stream emitted an unsupported chunk type");
    }
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

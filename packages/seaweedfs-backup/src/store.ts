import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { addAbortSignal, Readable } from "node:stream";
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

export type ObjectStoreExecution = {
  signal?: AbortSignal;
  onProgress?: () => void;
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
  public constructor(
    private readonly client: S3Client,
    private readonly execution: ObjectStoreExecution = {},
  ) {}

  private requestOptions(): { abortSignal?: AbortSignal } {
    this.execution.signal?.throwIfAborted();
    this.execution.onProgress?.();
    this.execution.signal?.throwIfAborted();
    return this.execution.signal === undefined
      ? {}
      : { abortSignal: this.execution.signal };
  }

  public async listBuckets(): Promise<string[]> {
    const response = await this.client.send(
      new ListBucketsCommand({}),
      this.requestOptions(),
    );
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
        this.requestOptions(),
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
      this.requestOptions(),
    );
    const body = bodyAsReadable(response.Body, bucket, key);
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
      body:
        this.execution.signal === undefined
          ? body
          : addAbortSignal(this.execution.signal, body),
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
        this.requestOptions(),
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
    this.requestOptions();
    const expires =
      input.headers.expires === undefined
        ? undefined
        : new Date(input.headers.expires);
    const params = {
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
    };
    // Maintenance publishes buffered manifests and candidate sets. Upload's
    // abortController does not cancel its underlying PutObject HTTP request.
    if (
      this.execution.signal !== undefined &&
      input.body instanceof Uint8Array
    ) {
      await this.client.send(
        new PutObjectCommand(params),
        this.requestOptions(),
      );
      return;
    }
    const controller = new AbortController();
    const cancel = (): void => {
      controller.abort(this.execution.signal?.reason);
    };
    this.execution.signal?.addEventListener("abort", cancel, { once: true });
    if (this.execution.signal?.aborted === true) cancel();
    try {
      await new Upload({
        client: this.client,
        abortController: controller,
        leavePartsOnError: false,
        params,
      }).done();
    } finally {
      this.execution.signal?.removeEventListener("abort", cancel);
    }
  }

  public async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      this.requestOptions(),
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
    // Bun's node:http compatibility layer can throw ERR_SOCKET_CLOSED outside
    // the request promise when the default keep-alive pool reuses a stale S3
    // socket. Dedicated request sockets preserve raw response bytes while
    // keeping transport failures attached to the request that owns them.
    requestHandler: {
      httpAgent: { keepAlive: false, maxSockets: Number.POSITIVE_INFINITY },
      httpsAgent: { keepAlive: false, maxSockets: Number.POSITIVE_INFINITY },
    },
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
  execution?: ObjectStoreExecution;
}): ObjectStore {
  return new S3ObjectStore(createS3Client(input), input.execution);
}

export function storesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  execution?: ObjectStoreExecution,
): { source: ObjectStore; destination: ObjectStore; backupBucket: string } {
  const parsed = BackupEnvironmentSchema.parse(environment);
  return {
    source: createS3ObjectStore({
      endpoint: parsed.SEAWEEDFS_BACKUP_SOURCE_ENDPOINT,
      accessKeyId: parsed.SEAWEEDFS_BACKUP_SOURCE_ACCESS_KEY_ID,
      secretAccessKey: parsed.SEAWEEDFS_BACKUP_SOURCE_SECRET_ACCESS_KEY,
      ...(execution === undefined ? {} : { execution }),
    }),
    destination: createS3ObjectStore({
      endpoint: parsed.R2_BACKUP_ENDPOINT,
      accessKeyId: parsed.R2_BACKUP_ACCESS_KEY_ID,
      secretAccessKey: parsed.R2_BACKUP_SECRET_ACCESS_KEY,
      region: "auto",
      ...(execution === undefined ? {} : { execution }),
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

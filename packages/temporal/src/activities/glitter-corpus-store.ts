import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import { sha256 } from "#shared/glitter-corpus-projection.ts";

export type CorpusStoreName = "seaweedfs";

export type CorpusStore = {
  name: CorpusStoreName;
  bucket: string;
  client: S3Client;
};

const S3ErrorShapeSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

const TRANSIENT_STORAGE_ERROR_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/i;

function isTransientStorageFailure(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  const statusCode = parsed.data.$metadata?.httpStatusCode;
  if (
    statusCode !== undefined &&
    (statusCode === 408 || statusCode === 429 || statusCode >= 500)
  ) {
    return true;
  }
  // The structured `code` is the only reliable carrier: Bun's AWS SDK reports a
  // mid-request socket close as `TimeoutError` / "The socket connection was
  // closed unexpectedly", with ECONNRESET only on `code`.
  const code = parsed.data.code ?? "";
  return TRANSIENT_STORAGE_ERROR_PATTERN.test(
    error instanceof Error ? `${code} ${error.name} ${error.message}` : code,
  );
}

/**
 * Walks the error and its `.cause` chain (the same traversal
 * `collectErrorMessages` uses for activity failures) because an HTTP handler
 * may wrap the connection failure: the transport code and `$metadata` can live
 * one or more levels below a generic outer error.
 */
export function isTransientCorpusStorageError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (isTransientStorageFailure(current)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export function isNotFoundError(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  return (
    parsed.data.name === "NotFound" ||
    parsed.data.name === "NoSuchKey" ||
    parsed.data.$metadata?.httpStatusCode === 404
  );
}

export function isPreconditionFailedError(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  return (
    parsed.data.name === "PreconditionFailed" ||
    parsed.data.$metadata?.httpStatusCode === 409 ||
    parsed.data.$metadata?.httpStatusCode === 412
  );
}

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the Glitter Discord corpus`);
  }
  return value;
}

function createStore(input: {
  name: CorpusStoreName;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  forcePathStyle: boolean;
}): CorpusStore {
  return {
    name: input.name,
    bucket: input.bucket,
    client: new S3Client({
      endpoint: input.endpoint,
      region: input.region,
      forcePathStyle: input.forcePathStyle,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
    }),
  };
}

export function createCorpusStoreFromEnv(): CorpusStore {
  return createStore({
    name: "seaweedfs",
    endpoint: requireEnv("GLITTER_CORPUS_S3_ENDPOINT"),
    bucket: requireEnv("GLITTER_CORPUS_S3_BUCKET"),
    accessKeyId: requireEnv("GLITTER_CORPUS_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("GLITTER_CORPUS_S3_SECRET_ACCESS_KEY"),
    region: Bun.env["GLITTER_CORPUS_S3_REGION"] ?? "us-east-1",
    forcePathStyle: true,
  });
}

export async function getObjectBytes(
  store: CorpusStore,
  key: string,
): Promise<Uint8Array | undefined> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    if (response.Body === undefined) {
      throw new Error(
        `${store.name} returned an empty body for s3://${store.bucket}/${key}`,
      );
    }
    return await response.Body.transformToByteArray();
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function objectEtag(
  store: CorpusStore,
  key: string,
): Promise<string | undefined> {
  try {
    const response = await store.client.send(
      new HeadObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    return response.ETag;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function putMutableJson(
  store: CorpusStore,
  key: string,
  value: unknown,
  expectedEtag: string | undefined,
): Promise<void> {
  const body = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      Metadata: { sha256: sha256(body) },
      ...(expectedEtag === undefined
        ? { IfNoneMatch: "*" }
        : { IfMatch: expectedEtag }),
    }),
  );
}

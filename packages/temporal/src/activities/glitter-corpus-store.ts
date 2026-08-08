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
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

const TRANSIENT_STORAGE_ERROR_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/i;

export function isTransientCorpusStorageError(error: unknown): boolean {
  const parsed = S3ErrorShapeSchema.safeParse(error);
  const statusCode = parsed.success
    ? parsed.data.$metadata?.httpStatusCode
    : undefined;
  if (
    statusCode !== undefined &&
    (statusCode === 408 || statusCode === 429 || statusCode >= 500)
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    TRANSIENT_STORAGE_ERROR_PATTERN.test(`${error.name} ${error.message}`)
  );
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

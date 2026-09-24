import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { sha256 } from "#shared/glitter/glitter-corpus-projection.ts";
import { parseS3ErrorShape } from "#shared/infra/s3.ts";

export type CorpusStoreName = "seaweedfs";

export type CorpusStore = {
  name: CorpusStoreName;
  bucket: string;
  client: S3Client;
};

export function isNotFoundError(error: unknown): boolean {
  const shape = parseS3ErrorShape(error);
  return (
    shape !== undefined &&
    (shape.name === "NotFound" ||
      shape.name === "NoSuchKey" ||
      shape.$metadata?.httpStatusCode === 404)
  );
}

export function isPreconditionFailedError(error: unknown): boolean {
  const shape = parseS3ErrorShape(error);
  return (
    shape !== undefined &&
    (shape.name === "PreconditionFailed" ||
      shape.$metadata?.httpStatusCode === 409 ||
      shape.$metadata?.httpStatusCode === 412)
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

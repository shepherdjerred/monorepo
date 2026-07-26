import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import {
  MirrorObjectReceiptSchema,
  MirroredObjectSchema,
  type MirroredObject,
  type MirrorObjectReceipt,
} from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import { glitterCorpusMirrorDivergenceTotal } from "#observability/metrics.ts";

export type CorpusStoreName = "seaweedfs" | "r2";

type CorpusStore = {
  name: CorpusStoreName;
  bucket: string;
  client: S3Client;
};

const S3ErrorShapeSchema = z.object({
  name: z.string().optional(),
  $metadata: z.object({ httpStatusCode: z.number().optional() }).optional(),
});

export const LatestSnapshotPointerSchema = z
  .object({
    schemaVersion: z.literal(1),
    guildId: z.string().regex(/^\d+$/),
    snapshotId: z.uuid(),
    snapshotKey: z.string().min(1),
    snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type LatestSnapshotPointer = z.infer<typeof LatestSnapshotPointerSchema>;

function isNotFoundError(error: unknown): boolean {
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

export function createCorpusStoresFromEnv(): [CorpusStore, CorpusStore] {
  const seaweedfs = createStore({
    name: "seaweedfs",
    endpoint: requireEnv("GLITTER_CORPUS_S3_ENDPOINT"),
    bucket: requireEnv("GLITTER_CORPUS_S3_BUCKET"),
    accessKeyId: requireEnv("GLITTER_CORPUS_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("GLITTER_CORPUS_S3_SECRET_ACCESS_KEY"),
    region: Bun.env["GLITTER_CORPUS_S3_REGION"] ?? "us-east-1",
    forcePathStyle: true,
  });
  const r2 = createStore({
    name: "r2",
    endpoint: requireEnv("GLITTER_CORPUS_R2_ENDPOINT"),
    bucket: requireEnv("GLITTER_CORPUS_R2_BUCKET"),
    accessKeyId: requireEnv("GLITTER_CORPUS_R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("GLITTER_CORPUS_R2_SECRET_ACCESS_KEY"),
    region: Bun.env["GLITTER_CORPUS_R2_REGION"] ?? "auto",
    forcePathStyle: false,
  });
  return [seaweedfs, r2];
}

async function getObjectBytes(
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

async function objectEtag(
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

async function putImmutableObject(input: {
  store: CorpusStore;
  key: string;
  body: Uint8Array;
  contentType: string;
  writtenAt: string;
}): Promise<MirrorObjectReceipt> {
  const expectedSha256 = sha256(input.body);
  const existingEtag = await objectEtag(input.store, input.key);
  if (existingEtag !== undefined) {
    const existing = await getObjectBytes(input.store, input.key);
    if (existing === undefined) {
      throw new Error(
        `${input.store.name} object disappeared during immutable verification: ${input.key}`,
      );
    }
    const existingSha256 = sha256(existing);
    if (existingSha256 !== expectedSha256) {
      throw new Error(
        `immutable object collision at ${input.store.name}:${input.key}; existing ${existingSha256}, incoming ${expectedSha256}`,
      );
    }
    return MirrorObjectReceiptSchema.parse({
      store: input.store.name,
      bucket: input.store.bucket,
      key: input.key,
      sha256: expectedSha256,
      etag: existingEtag,
      writtenAt: input.writtenAt,
    });
  }

  const response = await input.store.client.send(
    new PutObjectCommand({
      Bucket: input.store.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: { sha256: expectedSha256 },
    }),
  );
  if (response.ETag === undefined || response.ETag === "") {
    throw new Error(
      `${input.store.name} did not return an ETag for ${input.key}`,
    );
  }
  const stored = await getObjectBytes(input.store, input.key);
  if (stored === undefined) {
    throw new Error(
      `${input.store.name} object disappeared after write: ${input.key}`,
    );
  }
  const storedSha256 = sha256(stored);
  if (storedSha256 !== expectedSha256) {
    throw new Error(
      `${input.store.name} corrupted ${input.key} during write: expected ${expectedSha256}, read ${storedSha256}`,
    );
  }
  return MirrorObjectReceiptSchema.parse({
    store: input.store.name,
    bucket: input.store.bucket,
    key: input.key,
    sha256: expectedSha256,
    etag: response.ETag,
    writtenAt: input.writtenAt,
  });
}

export async function putMirroredImmutableObject(input: {
  stores: readonly [CorpusStore, CorpusStore];
  key: string;
  body: Uint8Array;
  contentType: string;
  writtenAt: string;
}): Promise<MirroredObject> {
  const [first, second] = input.stores;
  const firstReceipt = await putImmutableObject({
    store: first,
    key: input.key,
    body: input.body,
    contentType: input.contentType,
    writtenAt: input.writtenAt,
  });
  const secondReceipt = await putImmutableObject({
    store: second,
    key: input.key,
    body: input.body,
    contentType: input.contentType,
    writtenAt: input.writtenAt,
  });

  return MirroredObjectSchema.parse({
    key: input.key,
    sha256: sha256(input.body),
    receipts: [firstReceipt, secondReceipt],
  });
}

async function putMutableJson(
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

export function latestSnapshotPointerNeedsUpdate(
  existing: LatestSnapshotPointer | undefined,
  incoming: LatestSnapshotPointer,
): boolean {
  if (existing === undefined) {
    return true;
  }
  const timeComparison =
    Date.parse(incoming.publishedAt) - Date.parse(existing.publishedAt);
  if (timeComparison < 0) {
    throw new Error(
      `refusing to move latest pointer backward from ${existing.publishedAt} to ${incoming.publishedAt}`,
    );
  }
  if (timeComparison === 0) {
    if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
      throw new Error(
        `latest pointer has a conflicting snapshot at ${incoming.publishedAt}`,
      );
    }
    return false;
  }
  return true;
}

async function prepareLatestPointerUpdate(input: {
  store: CorpusStore;
  pointerKey: string;
  incoming: LatestSnapshotPointer;
}): Promise<{ expectedEtag: string | undefined; shouldWrite: boolean }> {
  const expectedEtag = await objectEtag(input.store, input.pointerKey);
  if (expectedEtag === undefined) {
    return { expectedEtag, shouldWrite: true };
  }
  const existingBytes = await getObjectBytes(input.store, input.pointerKey);
  if (existingBytes === undefined) {
    throw new Error(
      `${input.store.name} latest pointer disappeared after its ETag was read`,
    );
  }
  const existing = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(existingBytes)),
  );
  try {
    return {
      expectedEtag,
      shouldWrite: latestSnapshotPointerNeedsUpdate(existing, input.incoming),
    };
  } catch (error: unknown) {
    throw new Error(`${input.store.name} rejected latest pointer publication`, {
      cause: error,
    });
  }
}

export async function publishLatestSnapshotPointer(input: {
  stores: readonly [CorpusStore, CorpusStore];
  pointer: LatestSnapshotPointer;
}): Promise<void> {
  const pointer = LatestSnapshotPointerSchema.parse(input.pointer);
  const snapshotBytes = await Promise.all(
    input.stores.map((store) => getObjectBytes(store, pointer.snapshotKey)),
  );
  for (const [index, bytes] of snapshotBytes.entries()) {
    const store = input.stores[index];
    if (store === undefined || bytes === undefined) {
      throw new Error(
        `cannot publish latest pointer: ${store?.name ?? "unknown store"} is missing ${pointer.snapshotKey}`,
      );
    }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== pointer.snapshotSha256) {
      throw new Error(
        `cannot publish latest pointer: ${store.name} snapshot checksum ${actualSha256} does not match ${pointer.snapshotSha256}`,
      );
    }
  }

  const pointerKey = `guilds/${pointer.guildId}/snapshots/latest.json`;
  const updates = await Promise.all(
    input.stores.map(async (store) => ({
      store,
      update: await prepareLatestPointerUpdate({
        store,
        pointerKey,
        incoming: pointer,
      }),
    })),
  );
  for (const { store, update } of updates) {
    if (update.shouldWrite) {
      await putMutableJson(store, pointerKey, pointer, update.expectedEtag);
    }
  }

  for (const store of input.stores) {
    const bytes = await getObjectBytes(store, pointerKey);
    if (bytes === undefined) {
      throw new Error(
        `${store.name} latest pointer vanished after publication`,
      );
    }
    const storedPointer = LatestSnapshotPointerSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (JSON.stringify(storedPointer) !== JSON.stringify(pointer)) {
      throw new Error(
        `${store.name} latest pointer changed during publication`,
      );
    }
  }
}

export async function readMirroredObject(input: {
  stores: readonly [CorpusStore, CorpusStore];
  key: string;
}): Promise<Uint8Array | undefined> {
  const [firstBytes, secondBytes] = await Promise.all(
    input.stores.map((store) => getObjectBytes(store, input.key)),
  );
  if (firstBytes === undefined && secondBytes === undefined) {
    return undefined;
  }
  if (firstBytes === undefined || secondBytes === undefined) {
    glitterCorpusMirrorDivergenceTotal.inc();
    throw new Error(`mirror divergence: only one store contains ${input.key}`);
  }
  const firstSha256 = sha256(firstBytes);
  const secondSha256 = sha256(secondBytes);
  if (firstSha256 !== secondSha256) {
    glitterCorpusMirrorDivergenceTotal.inc();
    throw new Error(
      `mirror divergence for ${input.key}: ${firstSha256} != ${secondSha256}`,
    );
  }
  return firstBytes;
}

export async function readAndRepairMirroredImmutableObject(input: {
  stores: readonly [CorpusStore, CorpusStore];
  key: string;
  contentType: string;
  repairedAt: string;
}): Promise<Uint8Array | undefined> {
  const [first, second] = input.stores;
  const [firstBytes, secondBytes] = await Promise.all([
    getObjectBytes(first, input.key),
    getObjectBytes(second, input.key),
  ]);
  if (firstBytes === undefined && secondBytes === undefined) {
    return undefined;
  }
  if (firstBytes !== undefined && secondBytes !== undefined) {
    if (sha256(firstBytes) !== sha256(secondBytes)) {
      glitterCorpusMirrorDivergenceTotal.inc();
      throw new Error(`mirror divergence for immutable ${input.key}`);
    }
    return firstBytes;
  }
  glitterCorpusMirrorDivergenceTotal.inc();
  const body = firstBytes ?? secondBytes;
  if (body === undefined) {
    throw new Error(`partial mirror body disappeared: ${input.key}`);
  }
  const missingStore = firstBytes === undefined ? first : second;
  await putImmutableObject({
    store: missingStore,
    key: input.key,
    body,
    contentType: input.contentType,
    writtenAt: input.repairedAt,
  });
  const repaired = await readMirroredObject({
    stores: input.stores,
    key: input.key,
  });
  if (repaired === undefined) {
    throw new Error(`repaired immutable object disappeared: ${input.key}`);
  }
  return repaired;
}

export async function readVerifiedMirroredObject(input: {
  stores: readonly [CorpusStore, CorpusStore];
  key: string;
  expectedSha256: string;
}): Promise<Uint8Array> {
  const bytes = await readMirroredObject({
    stores: input.stores,
    key: input.key,
  });
  if (bytes === undefined || sha256(bytes) !== input.expectedSha256) {
    throw new Error(`mirrored object checksum mismatch: ${input.key}`);
  }
  return bytes;
}

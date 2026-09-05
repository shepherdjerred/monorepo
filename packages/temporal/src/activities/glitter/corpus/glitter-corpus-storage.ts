import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import {
  StoredObjectReceiptSchema,
  StoredObjectSchema,
  type StoredObject,
  type StoredObjectReceipt,
} from "#shared/glitter-corpus.ts";
import { sha256 } from "#shared/glitter-corpus-projection.ts";
import { glitterCorpusStorageIntegrityFailuresTotal } from "#observability/metrics-glitter.ts";
import {
  getObjectBytes,
  objectEtag,
  putMutableJson,
  type CorpusStore,
} from "./glitter-corpus-store.ts";

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

function storageIntegrityError(message: string): Error {
  glitterCorpusStorageIntegrityFailuresTotal.inc();
  return new Error(message);
}

async function putImmutableObjectReceipt(input: {
  store: CorpusStore;
  key: string;
  body: Uint8Array;
  contentType: string;
  writtenAt: string;
}): Promise<StoredObjectReceipt> {
  const expectedSha256 = sha256(input.body);
  const existingEtag = await objectEtag(input.store, input.key);
  if (existingEtag !== undefined) {
    const existing = await getObjectBytes(input.store, input.key);
    if (existing === undefined) {
      throw storageIntegrityError(
        `${input.store.name} object disappeared during immutable verification: ${input.key}`,
      );
    }
    const existingSha256 = sha256(existing);
    if (existingSha256 !== expectedSha256) {
      throw storageIntegrityError(
        `immutable object collision at ${input.store.name}:${input.key}; existing ${existingSha256}, incoming ${expectedSha256}`,
      );
    }
    return StoredObjectReceiptSchema.parse({
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
    throw storageIntegrityError(
      `${input.store.name} did not return an ETag for ${input.key}`,
    );
  }
  const stored = await getObjectBytes(input.store, input.key);
  if (stored === undefined) {
    throw storageIntegrityError(
      `${input.store.name} object disappeared after write: ${input.key}`,
    );
  }
  const storedSha256 = sha256(stored);
  if (storedSha256 !== expectedSha256) {
    throw storageIntegrityError(
      `${input.store.name} corrupted ${input.key} during write: expected ${expectedSha256}, read ${storedSha256}`,
    );
  }
  return StoredObjectReceiptSchema.parse({
    store: input.store.name,
    bucket: input.store.bucket,
    key: input.key,
    sha256: expectedSha256,
    etag: response.ETag,
    writtenAt: input.writtenAt,
  });
}

export async function putImmutableObject(input: {
  store: CorpusStore;
  key: string;
  body: Uint8Array;
  contentType: string;
  writtenAt: string;
}): Promise<StoredObject> {
  const receipt = await putImmutableObjectReceipt({
    store: input.store,
    key: input.key,
    body: input.body,
    contentType: input.contentType,
    writtenAt: input.writtenAt,
  });

  return StoredObjectSchema.parse({
    key: input.key,
    sha256: sha256(input.body),
    receipt,
  });
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
    throw storageIntegrityError(
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
  store: CorpusStore;
  pointer: LatestSnapshotPointer;
}): Promise<void> {
  const pointer = LatestSnapshotPointerSchema.parse(input.pointer);
  const snapshotBytes = await getObjectBytes(input.store, pointer.snapshotKey);
  if (snapshotBytes === undefined) {
    throw storageIntegrityError(
      `cannot publish latest pointer: ${input.store.name} is missing ${pointer.snapshotKey}`,
    );
  }
  const actualSha256 = sha256(snapshotBytes);
  if (actualSha256 !== pointer.snapshotSha256) {
    throw storageIntegrityError(
      `cannot publish latest pointer: ${input.store.name} snapshot checksum ${actualSha256} does not match ${pointer.snapshotSha256}`,
    );
  }

  const pointerKey = `guilds/${pointer.guildId}/snapshots/latest.json`;
  const update = await prepareLatestPointerUpdate({
    store: input.store,
    pointerKey,
    incoming: pointer,
  });
  if (update.shouldWrite) {
    await putMutableJson(input.store, pointerKey, pointer, update.expectedEtag);
  }

  const bytes = await getObjectBytes(input.store, pointerKey);
  if (bytes === undefined) {
    throw storageIntegrityError(
      `${input.store.name} latest pointer vanished after publication`,
    );
  }
  const storedPointer = LatestSnapshotPointerSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (JSON.stringify(storedPointer) !== JSON.stringify(pointer)) {
    throw new Error(
      `${input.store.name} latest pointer changed during publication`,
    );
  }
}

export async function readObject(input: {
  store: CorpusStore;
  key: string;
}): Promise<Uint8Array | undefined> {
  return getObjectBytes(input.store, input.key);
}

export async function readRequiredObject(input: {
  store: CorpusStore;
  key: string;
}): Promise<Uint8Array> {
  const bytes = await readObject(input);
  if (bytes === undefined) {
    throw storageIntegrityError(
      `${input.store.name} is missing required object: ${input.key}`,
    );
  }
  return bytes;
}

export async function readVerifiedObject(input: {
  store: CorpusStore;
  key: string;
  expectedSha256: string;
}): Promise<Uint8Array> {
  const bytes = await readRequiredObject({
    store: input.store,
    key: input.key,
  });
  if (sha256(bytes) !== input.expectedSha256) {
    throw storageIntegrityError(
      `stored object checksum mismatch: ${input.key}`,
    );
  }
  return bytes;
}

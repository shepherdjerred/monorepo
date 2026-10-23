import { ApplicationFailure } from "@temporalio/common";
import {
  createS3ObjectStore,
  type ObjectStore,
} from "@shepherdjerred/seaweedfs-backup/store";
import {
  COLD_START_SNAPSHOT,
  ColdStartSnapshotSchema,
  coldStartArchiveKey,
} from "@shepherdjerred/delivery/model-contract";
import { z } from "zod";
import type { ColdStartWrite } from "#lib/delivery/model/oracle-inputs.ts";

export type DeliveryColdStartActivities = typeof deliveryColdStartActivities;

/** The homelab R2 bucket's credential (Velero's and WAL-G's), from the worker's environment. */
const ColdStartCredentialSchema = z.object({
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().min(1),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().min(1),
});

/** The snapshot stored at `key` as written, or null when there is none. */
async function storedText(
  store: ObjectStore,
  key: string,
): Promise<string | null> {
  const { bucket } = COLD_START_SNAPSHOT;
  if ((await store.headObject(bucket, key)) === undefined) return null;
  const object = await store.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body)
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A snapshot's write time in microseconds since the epoch. Delivery takes
 * `writtenAt` from its database clock to the microsecond while it builds
 * snapshots one at a time, so this orders snapshots as their records were
 * read; a millisecond-only time compares as its first microsecond.
 */
function writtenAtOrder(writtenAt: string): bigint {
  const fraction = /\.(\d+)Z$/u.exec(writtenAt)?.[1] ?? "";
  const micros = fraction.padEnd(6, "0").slice(3, 6);
  return BigInt(Date.parse(writtenAt)) * 1000n + BigInt(micros);
}

/**
 * Writes the immutable copy, then advances `latest.json` only when this
 * snapshot is at least as new as the one it holds. A retried older Activity
 * therefore never moves the pointer back past a newer acceptance; the
 * backup worker runs one task at a time, so the read and write do not race.
 * Two different snapshots never share a write time, so one that would
 * share the pointer's, or find other bytes in its immutable copy, is refused
 * before anything is written.
 */
export async function writeColdStartObjects(
  store: ObjectStore,
  input: ColdStartWrite,
) {
  const text = JSON.stringify(input.snapshot);
  const bytes = new TextEncoder().encode(text);
  const archive = coldStartArchiveKey(input.snapshot);
  const archived = await storedText(store, archive);
  if (archived !== null && archived !== text)
    throw ApplicationFailure.nonRetryable(
      `The immutable cold-start copy ${archive} already holds a different snapshot; it is never overwritten`,
      "DeliveryColdStartOrder",
    );
  const current = await storedText(store, COLD_START_SNAPSHOT.key);
  const order = writtenAtOrder(input.snapshot.writtenAt);
  const currentOrder =
    current === null
      ? null
      : writtenAtOrder(
          ColdStartSnapshotSchema.parse(JSON.parse(current)).writtenAt,
        );
  if (currentOrder === order && current !== text)
    throw ApplicationFailure.nonRetryable(
      `latest.json already holds a different snapshot written at ${input.snapshot.writtenAt}; snapshots are ordered by write time, so this one is refused`,
      "DeliveryColdStartOrder",
    );
  const advance = currentOrder === null || currentOrder <= order;
  for (const key of advance ? [archive, COLD_START_SNAPSHOT.key] : [archive])
    await store.putObject({
      bucket: COLD_START_SNAPSHOT.bucket,
      key,
      body: bytes,
      contentLength: bytes.byteLength,
      headers: {
        contentType: "application/json",
        metadata: { fingerprint: input.fingerprint },
      },
    });
  return archive;
}

/**
 * Runs on the backup worker, which holds the off-cluster R2 credential: the
 * snapshot lands immutably under its write time and catalog revision, then
 * as `latest.json`, the object the bootstrap tool and reconcile-after-restore
 * read (section 6, X7). The receipt names the immutable copy.
 */
export const deliveryColdStartActivities = {
  async writeDeliveryColdStart(input: ColdStartWrite) {
    const credential = ColdStartCredentialSchema.parse(Bun.env);
    const store = createS3ObjectStore({
      endpoint: COLD_START_SNAPSHOT.endpoint,
      accessKeyId: credential.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: credential.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      region: "auto",
    });
    const archive = await writeColdStartObjects(store, input);
    return {
      fingerprint: input.fingerprint,
      uri: `s3://${COLD_START_SNAPSHOT.bucket}/${archive}`,
      writtenAt: input.snapshot.writtenAt,
    };
  },
};

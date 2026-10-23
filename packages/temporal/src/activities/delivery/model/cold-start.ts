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

/** When the current `latest.json` was written, or null before the first snapshot. */
async function latestWrittenAt(store: ObjectStore): Promise<number | null> {
  const { bucket, key } = COLD_START_SNAPSHOT;
  if ((await store.headObject(bucket, key)) === undefined) return null;
  const object = await store.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of object.body)
    chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
  const text = Buffer.concat(chunks).toString("utf8");
  return Date.parse(ColdStartSnapshotSchema.parse(JSON.parse(text)).writtenAt);
}

/**
 * Writes the immutable copy, then advances `latest.json` only when this
 * snapshot is at least as new as the one it holds. A retried older Activity
 * therefore never moves the pointer back past a newer acceptance; the
 * backup worker runs one task at a time, so the read and write do not race.
 */
export async function writeColdStartObjects(
  store: ObjectStore,
  input: ColdStartWrite,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(input.snapshot));
  const archive = coldStartArchiveKey(input.snapshot);
  const current = await latestWrittenAt(store);
  const advance =
    current === null || current <= Date.parse(input.snapshot.writtenAt);
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

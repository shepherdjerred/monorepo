import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import {
  conditionalWrite,
  readJson,
  writeJson,
  type ReportReceiptStore,
} from "./report-object-store.ts";

const HeartbeatSchema = z.object({
  objectKey: z.string().min(1),
  timestamp: z.iso.datetime({ offset: true }),
});
const HeartbeatIndexSchema = z.object({
  schemaVersion: z.literal(1),
  latest: HeartbeatSchema.optional(),
  backfill: z.object({
    complete: z.boolean(),
    afterKey: z.string().min(1).optional(),
  }),
});
type Heartbeat = z.infer<typeof HeartbeatSchema>;
type HeartbeatIndex = z.infer<typeof HeartbeatIndexSchema>;
export const REPORT_HEARTBEAT_BACKFILL_PAGE_SIZE = 25;

function indexKey(prefix: string): string {
  if (!prefix.endsWith("/")) throw new Error("Heartbeat prefix must end in /");
  // A sibling, outside the immutable objects' listing prefix.
  return `${prefix.slice(0, -1)}.latest-index.json`;
}

function newer(a: Heartbeat | undefined, b: Heartbeat | undefined) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a;
}

async function updateIndex(
  store: ReportReceiptStore,
  prefix: string,
  update: (current: HeartbeatIndex) => HeartbeatIndex,
): Promise<HeartbeatIndex> {
  const key = indexKey(prefix);
  for (let attempt = 0; attempt < 5; attempt++) {
    const stored = await readJson(store, key, HeartbeatIndexSchema);
    const current = stored?.value ?? {
      schemaVersion: 1,
      backfill: { complete: false },
    };
    const next = HeartbeatIndexSchema.parse(update(current));
    if (
      stored !== undefined &&
      JSON.stringify(next) === JSON.stringify(current)
    )
      return current;
    const written = await conditionalWrite(() =>
      writeJson(store, key, next, { expectedEtag: stored?.etag }),
    );
    if (written) return next;
  }
  throw new Error(`Report heartbeat index is contended: ${key}`);
}

/** Called only after reading or creating an immutable, validated record. */
export async function recordReportHeartbeat(
  store: ReportReceiptStore,
  objectKey: string,
  timestamp: string,
): Promise<void> {
  const prefix = objectKey.slice(0, objectKey.lastIndexOf("/") + 1);
  const heartbeat = HeartbeatSchema.parse({ objectKey, timestamp });
  await updateIndex(store, prefix, (current) => ({
    ...current,
    latest: newer(current.latest, heartbeat),
  }));
}

/**
 * One bounded legacy page per scan, then constant work after migration. CAS
 * merges concurrent deliveries without moving either timestamp or cursor back.
 * The reader validates the original record; S3 LastModified is never a clock.
 */
export async function inspectReportHeartbeat(
  store: ReportReceiptStore,
  prefix: string,
  readTimestamp: (key: string) => Promise<string>,
): Promise<{ timestamp: string | undefined; complete: boolean }> {
  const stored = await readJson(store, indexKey(prefix), HeartbeatIndexSchema);
  let index = stored?.value;
  if (index?.backfill.complete !== true) {
    const afterKey = index?.backfill.afterKey;
    const page = await store.client.send(
      new ListObjectsV2Command({
        Bucket: store.bucket,
        Prefix: prefix,
        MaxKeys: REPORT_HEARTBEAT_BACKFILL_PAGE_SIZE,
        ...(afterKey === undefined ? {} : { StartAfter: afterKey }),
      }),
    );
    const keys = (page.Contents ?? []).map((object) => {
      if (object.Key?.startsWith(prefix) !== true)
        throw new Error(`Invalid report heartbeat listing for ${prefix}`);
      return object.Key;
    });
    if (page.IsTruncated === true && keys.length === 0)
      throw new Error(`Truncated report heartbeat listing is empty: ${prefix}`);
    const records = await Promise.all(
      keys.map(async (objectKey) =>
        HeartbeatSchema.parse({
          objectKey,
          timestamp: await readTimestamp(objectKey),
        }),
      ),
    );
    const latest = records.reduce<Heartbeat | undefined>(
      (previous, record) => newer(previous, record),
      undefined,
    );
    index = await updateIndex(store, prefix, (current) => ({
      ...current,
      latest: newer(current.latest, latest),
      // Another scanner may have advanced while this page was read.
      backfill:
        current.backfill.complete || current.backfill.afterKey !== afterKey
          ? current.backfill
          : {
              complete: page.IsTruncated !== true,
              ...(keys.at(-1) === undefined ? {} : { afterKey: keys.at(-1) }),
            },
    }));
  }
  if (index.latest === undefined)
    return { timestamp: undefined, complete: index.backfill.complete };
  if (!index.latest.objectKey.startsWith(prefix))
    throw new Error(
      `Report heartbeat index references a different family: ${prefix}`,
    );
  const timestamp = await readTimestamp(index.latest.objectKey);
  if (Date.parse(timestamp) !== Date.parse(index.latest.timestamp))
    throw new Error(
      `Report heartbeat index differs from its immutable record: ${prefix}`,
    );
  return { timestamp, complete: index.backfill.complete };
}

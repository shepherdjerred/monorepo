import { Readable } from "node:stream";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod/v4";
import { readJson } from "./report-object-store.ts";
import {
  inspectReportHeartbeat,
  recordReportHeartbeat,
  REPORT_HEARTBEAT_BACKFILL_PAGE_SIZE,
} from "./report-heartbeat-index.ts";

const PREFIX = "reports/receipts/daily/daily-report/";
const INDEX_KEY = `${PREFIX.slice(0, -1)}.latest-index.json`;
const OLD = "2026-08-01T12:00:00.000Z";
const RECENT = "2026-10-10T07:00:00.000Z";

function storage() {
  const objects = new Map<string, { text: string; etag: string }>();
  const client = new S3Client({ region: "us-east-1" });
  const reads: string[] = [];
  const listings: string[] = [];
  let sequence = 0;
  let beforeWrite: (() => void) | undefined;
  let failWrite = false;
  function put(key: string, value: unknown) {
    objects.set(key, { text: JSON.stringify(value), etag: String(++sequence) });
  }
  function write(command: PutObjectCommand, key: string) {
    if (failWrite) throw new Error("index store unavailable");
    const hook = beforeWrite;
    beforeWrite = undefined;
    hook?.();
    const stored = objects.get(key);
    if (
      (stored !== undefined && command.input.IfNoneMatch === "*") ||
      (command.input.IfMatch !== undefined &&
        stored?.etag !== command.input.IfMatch)
    )
      throw new S3ServiceException({
        name: "PreconditionFailed",
        $fault: "client",
        $metadata: { httpStatusCode: 412 },
      });
    if (typeof command.input.Body !== "string")
      throw new TypeError("Expected JSON body");
    put(key, JSON.parse(command.input.Body));
    return { $metadata: {} };
  }
  Object.defineProperty(client, "send", {
    value: vi.fn(
      async (
        command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command,
      ) => {
        if (
          command instanceof GetObjectCommand &&
          command.input.Key !== undefined
        ) {
          const key = command.input.Key;
          reads.push(key);
          const stored = objects.get(key);
          if (stored === undefined)
            throw new NoSuchKey({
              $metadata: { httpStatusCode: 404 },
              message: key,
            });
          return {
            $metadata: {},
            ETag: stored.etag,
            Body: Object.assign(Readable.from([stored.text]), {
              transformToString: async () => stored.text,
              transformToByteArray: async () =>
                new TextEncoder().encode(stored.text),
              transformToWebStream: () => new Blob([stored.text]).stream(),
            }),
          };
        }
        if (
          command instanceof PutObjectCommand &&
          command.input.Key !== undefined
        ) {
          return write(command, command.input.Key);
        }
        if (command instanceof ListObjectsV2Command) {
          const prefix = command.input.Prefix;
          if (prefix === undefined) throw new Error("Missing list prefix");
          listings.push(prefix);
          const keys = [...objects.keys()]
            .filter(
              (candidate) =>
                candidate.startsWith(prefix) &&
                candidate > (command.input.StartAfter ?? ""),
            )
            .sort();
          const page = keys.slice(0, command.input.MaxKeys);
          return {
            $metadata: {},
            Contents: page.map((objectKey) => ({
              Key: objectKey,
              LastModified: new Date(),
            })),
            IsTruncated: page.length < keys.length,
          };
        }
        throw new Error("Unexpected S3 command");
      },
    ),
  });
  const store = { client, bucket: "test", prefix: "reports/receipts" };
  return {
    store,
    put,
    reads,
    listings,
    beforeWrite: (hook: () => void) => {
      beforeWrite = hook;
    },
    failWrites: (fail: boolean) => {
      failWrite = fail;
    },
  };
}

describe("report heartbeat index", () => {
  test("bounds legacy reads and keeps only two GETs after migration", async () => {
    const backend = storage();
    const timestamps = new Map<string, string>();
    for (let i = 0; i < 60; i++) {
      const key = `${PREFIX}${String(i).padStart(3, "0")}.json`;
      backend.put(key, { acceptedAt: i === 42 ? RECENT : OLD });
      timestamps.set(key, i === 42 ? RECENT : OLD);
    }
    const readTimestamp = vi.fn(async (key: string) => {
      const timestamp = timestamps.get(key);
      if (timestamp === undefined) throw new Error("Missing original receipt");
      return timestamp;
    });
    for (let page = 0; page < 3; page++) {
      readTimestamp.mockClear();
      const result = await inspectReportHeartbeat(
        backend.store,
        PREFIX,
        readTimestamp,
      );
      expect(result.complete).toBe(page === 2);
      expect(readTimestamp.mock.calls.length).toBeLessThanOrEqual(
        REPORT_HEARTBEAT_BACKFILL_PAGE_SIZE + 1,
      );
      if (page === 2) expect(result.timestamp).toBe(RECENT);
    }
    backend.reads.length = 0;
    backend.listings.length = 0;
    await inspectReportHeartbeat(backend.store, PREFIX, async (key) => {
      const original = await readJson(
        backend.store,
        key,
        z.object({ acceptedAt: z.string() }),
      );
      if (original === undefined) throw new Error("Missing original receipt");
      return original.value.acceptedAt;
    });
    expect(backend.reads).toEqual([INDEX_KEY, `${PREFIX}042.json`]);
    expect(backend.listings).toEqual([]);
  });

  test("uses actual acceptance order even when old keys are rewritten later", async () => {
    const backend = storage();
    const newerKey = `${PREFIX}a-new.json`;
    const olderKey = `${PREFIX}z-old.json`;
    await recordReportHeartbeat(backend.store, newerKey, RECENT);
    await recordReportHeartbeat(backend.store, olderKey, OLD);
    backend.put(newerKey, {});
    backend.put(olderKey, {});
    const result = await inspectReportHeartbeat(
      backend.store,
      PREFIX,
      async (key) => (key === newerKey ? RECENT : OLD),
    );
    expect(result).toEqual({ timestamp: RECENT, complete: true });
  });

  test("merges a concurrent newer acceptance after a CAS conflict", async () => {
    const backend = storage();
    backend.beforeWrite(() =>
      backend.put(INDEX_KEY, {
        schemaVersion: 1,
        latest: { objectKey: `${PREFIX}new.json`, timestamp: RECENT },
        backfill: { complete: true },
      }),
    );
    await recordReportHeartbeat(backend.store, `${PREFIX}old.json`, OLD);
    expect(
      await inspectReportHeartbeat(backend.store, PREFIX, async () => RECENT),
    ).toEqual({ timestamp: RECENT, complete: true });
    expect(backend.listings).toEqual([]);
  });

  test("does not move a concurrently advanced migration cursor backwards", async () => {
    const backend = storage();
    backend.put(`${PREFIX}old.json`, {});
    backend.beforeWrite(() =>
      backend.put(INDEX_KEY, {
        schemaVersion: 1,
        latest: { objectKey: `${PREFIX}new.json`, timestamp: RECENT },
        backfill: { complete: true, afterKey: `${PREFIX}z.json` },
      }),
    );
    expect(
      await inspectReportHeartbeat(backend.store, PREFIX, async (key) =>
        key.endsWith("new.json") ? RECENT : OLD,
      ),
    ).toEqual({ timestamp: RECENT, complete: true });
    backend.listings.length = 0;
    await inspectReportHeartbeat(backend.store, PREFIX, async () => RECENT);
    expect(backend.listings).toEqual([]);
  });

  test("repairs an index write failure on retry without changing acceptance time", async () => {
    const backend = storage();
    backend.failWrites(true);
    await expect(
      recordReportHeartbeat(backend.store, `${PREFIX}accepted.json`, OLD),
    ).rejects.toThrow("index store unavailable");
    backend.failWrites(false);
    await recordReportHeartbeat(backend.store, `${PREFIX}accepted.json`, OLD);
    expect(
      await inspectReportHeartbeat(backend.store, PREFIX, async () => OLD),
    ).toEqual({ timestamp: OLD, complete: true });
  });

  test("rejects a timestamp that differs from the immutable original", async () => {
    const backend = storage();
    await recordReportHeartbeat(
      backend.store,
      `${PREFIX}accepted.json`,
      RECENT,
    );
    await expect(
      inspectReportHeartbeat(backend.store, PREFIX, async () => OLD),
    ).rejects.toThrow("differs from its immutable record");
  });
});

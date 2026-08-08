import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, spyOn, test } from "bun:test";
import { glitterCorpusStorageIntegrityFailuresTotal } from "#observability/metrics-glitter.ts";
import { StoredObjectSchema } from "#shared/glitter-corpus.ts";
import { discordRequestLeaseDelayMs } from "./glitter-corpus-rate-limit.ts";
import {
  isTransientCorpusStorageError,
  type CorpusStore,
} from "./glitter-corpus-store.ts";
import {
  LatestSnapshotPointerSchema,
  latestSnapshotPointerNeedsUpdate,
  readObject,
  readRequiredObject,
} from "./glitter-corpus-storage.ts";

function pointer(input: { snapshotId: string; publishedAt: string }) {
  return LatestSnapshotPointerSchema.parse({
    schemaVersion: 1,
    guildId: "1",
    snapshotId: input.snapshotId,
    snapshotKey: `snapshots/${input.snapshotId}.json`,
    snapshotSha256: "0".repeat(64),
    publishedAt: input.publishedAt,
  });
}

describe("Glitter corpus latest snapshot pointer", () => {
  test("allows only monotonic, idempotent publication", () => {
    const older = pointer({
      snapshotId: "00000000-0000-4000-8000-000000000001",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = pointer({
      snapshotId: "00000000-0000-4000-8000-000000000002",
      publishedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(latestSnapshotPointerNeedsUpdate(undefined, older)).toBe(true);
    expect(latestSnapshotPointerNeedsUpdate(older, older)).toBe(false);
    expect(latestSnapshotPointerNeedsUpdate(older, newer)).toBe(true);
    expect(() => latestSnapshotPointerNeedsUpdate(newer, older)).toThrow(
      "backward",
    );
  });

  test("rejects different snapshots at the same publication instant", () => {
    const first = pointer({
      snapshotId: "00000000-0000-4000-8000-000000000001",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = pointer({
      snapshotId: "00000000-0000-4000-8000-000000000002",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(() => latestSnapshotPointerNeedsUpdate(first, second)).toThrow(
      "conflicting",
    );
  });
});

describe("Glitter corpus transient storage errors", () => {
  test("recognizes transient connection failures", () => {
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
    ]) {
      expect(isTransientCorpusStorageError(new Error(code))).toBe(true);
    }
  });

  test("recognizes retryable HTTP responses", () => {
    for (const statusCode of [408, 429, 500, 503]) {
      const error = Object.assign(new Error(`HTTP ${String(statusCode)}`), {
        $metadata: { httpStatusCode: statusCode },
      });
      expect(isTransientCorpusStorageError(error)).toBe(true);
    }
  });

  test("does not retry permanent storage failures", () => {
    for (const statusCode of [401, 403, 404]) {
      const error = Object.assign(new Error(`HTTP ${String(statusCode)}`), {
        $metadata: { httpStatusCode: statusCode },
      });
      expect(isTransientCorpusStorageError(error)).toBe(false);
    }
    expect(
      isTransientCorpusStorageError(new Error("invalid snapshot JSON")),
    ).toBe(false);
  });
});

describe("Glitter corpus stored object receipt", () => {
  test("requires one matching SeaweedFS receipt", () => {
    const stored = StoredObjectSchema.parse({
      key: "seed/archive.zip",
      sha256: "a".repeat(64),
      receipt: {
        store: "seaweedfs",
        bucket: "glitter-discord-corpus",
        key: "seed/archive.zip",
        sha256: "a".repeat(64),
        etag: "etag",
        writtenAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(stored.receipt.store).toBe("seaweedfs");
    expect(() =>
      StoredObjectSchema.parse({
        ...stored,
        receipt: { ...stored.receipt, sha256: "b".repeat(64) },
      }),
    ).toThrow("storage receipt key and checksum must match");
    expect(() =>
      StoredObjectSchema.parse({
        ...stored,
        receipt: { ...stored.receipt, store: "r2" },
      }),
    ).toThrow();
  });
});

describe("Glitter corpus required reads", () => {
  test("counts missing required objects but not optional misses", async () => {
    let requestCount = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requestCount += 1;
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>',
          {
            status: 404,
            headers: { "content-type": "application/xml" },
          },
        );
      },
    });
    const client = new S3Client({
      endpoint: server.url.href,
      forcePathStyle: true,
      region: "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
    const store: CorpusStore = {
      name: "seaweedfs",
      bucket: "test",
      client,
    };
    const integrityFailure = spyOn(
      glitterCorpusStorageIntegrityFailuresTotal,
      "inc",
    );

    try {
      expect(
        await readObject({ store, key: "optional-cache-object.json" }),
      ).toBeUndefined();
      expect(integrityFailure).toHaveBeenCalledTimes(0);
      await expect(
        readRequiredObject({ store, key: "required-manifest.json" }),
      ).rejects.toThrow(
        "seaweedfs is missing required object: required-manifest.json",
      );
      expect(integrityFailure).toHaveBeenCalledTimes(1);
      expect(requestCount).toBe(2);
    } finally {
      integrityFailure.mockRestore();
      client.destroy();
      await server.stop(true);
    }
  });
});

describe("Glitter Discord distributed request lease", () => {
  test("waits until the persisted cross-process ceiling and never returns a negative delay", () => {
    expect(
      discordRequestLeaseDelayMs(
        "2026-01-01T00:00:01.000Z",
        Date.parse("2026-01-01T00:00:00.250Z"),
      ),
    ).toBe(750);
    expect(
      discordRequestLeaseDelayMs(
        "2026-01-01T00:00:01.000Z",
        Date.parse("2026-01-01T00:00:02.000Z"),
      ),
    ).toBe(0);
  });
});

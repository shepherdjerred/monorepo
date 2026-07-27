import { describe, expect, test } from "bun:test";
import { discordRequestLeaseDelayMs } from "./glitter-corpus-rate-limit.ts";
import {
  LatestSnapshotPointerSchema,
  latestSnapshotPointerNeedsUpdate,
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

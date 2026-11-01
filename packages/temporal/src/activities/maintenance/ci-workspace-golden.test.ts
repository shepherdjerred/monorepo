import { expect, test } from "vitest";
import {
  CI_WORKSPACE_VOLUME_BYTES,
  goldenSnapshotName,
  planGoldenPrune,
  publishGoldenSnapshot,
  quantityBytes,
  type CiWorkspaceGoldenClient,
  type GoldenSnapshot,
} from "./ci-workspace-golden.ts";

const request = {
  kind: "workspace-golden" as const,
  source: "abcdef0123456789".padEnd(40, "0"),
  fingerprint: "golden-v1",
  frozen: false,
  requestId: "12345678-aaaa-bbbb-cccc-dddddddddddd",
  pipeline: 7,
};

function snapshot(
  name: string,
  day: number,
  extra: Partial<GoldenSnapshot> = {},
) {
  return {
    name,
    createdAt: new Date(Date.UTC(2026, 9, day)),
    ready: true,
    error: undefined,
    deleting: false,
    restoreBytes: CI_WORKSPACE_VOLUME_BYTES,
    ...extra,
  };
}

function fakeClient(
  polls: (GoldenSnapshot | null)[],
  existing: GoldenSnapshot[],
) {
  const calls: string[] = [];
  const client: CiWorkspaceGoldenClient = {
    createSnapshot: (name, source) => {
      calls.push(`create ${name} ${source}`);
      return Promise.resolve();
    },
    getSnapshot: () => Promise.resolve(polls.shift() ?? null),
    listSnapshots: () => Promise.resolve(existing),
    deleteSnapshot: (name) => {
      calls.push(`delete ${name}`);
      return Promise.resolve();
    },
    selectSnapshot: (name) => {
      calls.push(`select ${name}`);
      return Promise.resolve();
    },
  };
  return { client, calls };
}

test("a retried request resumes the same snapshot name", () => {
  expect(goldenSnapshotName(request)).toBe(
    "ci-workspace-golden-abcdef012345-12345678",
  );
});

test("pruning keeps the selected snapshot and its newest predecessor", () => {
  const snapshots = [
    snapshot("ci-workspace-golden-a", 1),
    snapshot("ci-workspace-golden-b", 2),
    snapshot("ci-workspace-golden-c", 3),
    snapshot("ci-workspace-golden-d", 4),
    snapshot("ci-workspace-golden-old", 0, { deleting: true }),
    snapshot("unrelated-snapshot", 0),
  ];
  expect(planGoldenPrune(snapshots, "ci-workspace-golden-d")).toEqual([
    "ci-workspace-golden-b",
    "ci-workspace-golden-a",
  ]);
});

test("a snapshot is selected only once ready, then superseded ones are deleted", async () => {
  const name = goldenSnapshotName(request);
  const { client, calls } = fakeClient(
    [snapshot(name, 5, { ready: false }), snapshot(name, 5)],
    [
      snapshot("ci-workspace-golden-previous", 4),
      snapshot("ci-workspace-golden-older", 3),
      snapshot(name, 5),
    ],
  );
  const waits: number[] = [];
  const result = await publishGoldenSnapshot(client, request, (ms) => {
    waits.push(ms);
    return Promise.resolve();
  });
  expect(waits).toHaveLength(1);
  expect(calls).toEqual([
    `create ${name} ${request.source}`,
    `select ${name}`,
    "delete ci-workspace-golden-older",
  ]);
  expect(result).toEqual({
    snapshot: name,
    deleted: ["ci-workspace-golden-older"],
  });
});

test("a failed or vanished snapshot is never selected", async () => {
  const name = goldenSnapshotName(request);
  const failed = fakeClient(
    [snapshot(name, 5, { ready: false, error: "zfs snapshot failed" })],
    [],
  );
  await expect(
    publishGoldenSnapshot(failed.client, request, () => Promise.resolve()),
  ).rejects.toThrow("zfs snapshot failed");
  expect(failed.calls.some((call) => call.startsWith("select"))).toBe(false);
  const vanished = fakeClient([null], []);
  await expect(
    publishGoldenSnapshot(vanished.client, request, () => Promise.resolve()),
  ).rejects.toThrow("disappeared");
  expect(vanished.calls.some((call) => call.startsWith("select"))).toBe(false);
});

test("a ready snapshot larger than a workspace is never selected", async () => {
  const name = goldenSnapshotName(request);
  // 32G rounds up to 30Gi on ZFS: the snapshot outgrows a 32G workspace.
  const oversized = fakeClient(
    [snapshot(name, 5, { restoreBytes: quantityBytes("30Gi") })],
    [],
  );
  await expect(
    publishGoldenSnapshot(oversized.client, request, () => Promise.resolve()),
  ).rejects.toThrow("not the 34359738368 every workspace requests");
  expect(oversized.calls.some((call) => call.startsWith("select"))).toBe(false);
  const unknown = fakeClient(
    [snapshot(name, 5, { restoreBytes: undefined })],
    [],
  );
  await expect(
    publishGoldenSnapshot(unknown.client, request, () => Promise.resolve()),
  ).rejects.toThrow("restores undefined bytes");
});

test("restore sizes parse binary and decimal quantities and reject others", () => {
  expect(quantityBytes("32Gi")).toBe(CI_WORKSPACE_VOLUME_BYTES);
  expect(quantityBytes("32G")).toBe(32_000_000_000);
  expect(quantityBytes("1024")).toBe(1024);
  expect(() => quantityBytes("1.5Gi")).toThrow("Unsupported");
});

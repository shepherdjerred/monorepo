import { describe, expect, test } from "vitest";
import type { VeleroRestoreStatus } from "@shepherdjerred/ops-clients/kubernetes-storage.ts";
import { register } from "#observability/metrics.ts";
import { veleroRestoreSignals } from "./velero-restores.ts";
import { zfsDeletionSignals } from "./zfs-deletion.ts";

test("failed restores remain actionable independently of backup success", () => {
  const restore = {
    name: "rehearsal",
    namespace: "velero",
    createdAt: "2026-10-09T00:00:00Z",
    backupName: "completed-backup",
    phase: "PartiallyFailed" as const,
    errors: 1,
    classification: "unclassified" as const,
    supersededBy: undefined,
  };
  expect(veleroRestoreSignals([restore])).toMatchObject([
    { needsMe: true, severity: "warning" },
  ]);
  expect(
    veleroRestoreSignals([
      { ...restore, classification: "expected-admission-block" },
    ]),
  ).toMatchObject([{ needsMe: false, severity: "info" }]);
  expect(veleroRestoreSignals([{ ...restore, phase: "Completed" }])).toEqual(
    [],
  );
});

describe("a restore superseded by a later accepted restore", () => {
  const failed: VeleroRestoreStatus = {
    name: "pg18-rehearsal-temporal-full-oct8",
    namespace: "velero",
    createdAt: "2026-10-08T23:10:20Z",
    backupName: "pg18-preflight-temporal-oct8",
    phase: "PartiallyFailed",
    errors: 1,
    classification: "superseded-by-accepted-restore",
    supersededBy: "ops-native-full-20261010-v2",
  };
  const successor: VeleroRestoreStatus = {
    name: "ops-native-full-20261010-v2",
    namespace: "velero",
    createdAt: "2026-10-10T17:51:21Z",
    backupName: "pg18-preflight-temporal-oct8",
    phase: "Completed",
    errors: 0,
    classification: "unclassified",
    supersededBy: undefined,
  };

  test("is informational when the named restore completed the same backup later", () => {
    expect(veleroRestoreSignals([failed, successor])).toMatchObject([
      {
        needsMe: false,
        severity: "info",
        detail: expect.stringContaining("ops-native-full-20261010-v2"),
        attributes: { supersededBy: "ops-native-full-20261010-v2" },
      },
    ]);
  });

  test.each([
    { name: "the named restore is missing", restores: [failed] },
    {
      name: "the named restore did not complete",
      restores: [failed, { ...successor, phase: "PartiallyFailed" as const }],
    },
    {
      name: "the named restore used a different backup",
      restores: [failed, { ...successor, backupName: "other-backup" }],
    },
    {
      name: "the named restore is not later",
      restores: [failed, { ...successor, createdAt: "2026-10-08T00:00:00Z" }],
    },
    {
      name: "the named restore is in another namespace",
      restores: [failed, { ...successor, namespace: "other" }],
    },
  ])("stays an explicit warning when $name", ({ restores }) => {
    const signal = veleroRestoreSignals(restores).find(
      (candidate) => candidate.attributes?.["restore"] === failed.name,
    );
    expect(signal).toMatchObject({ needsMe: true, severity: "warning" });
    expect(signal?.detail).toContain("Classified as superseded, but");
  });
});

test("deletion uses physical referenced bytes and clears a self-healed inventory", async () => {
  const volume = {
    name: "ci-workspace",
    node: "torvalds",
    dataset: "pool/ci-workspace",
    deletedAt: "2026-10-09T00:00:00Z",
  };
  const bytes = [
    {
      metric: { node: volume.node, dataset_name: volume.dataset },
      value: 4096,
    },
  ];
  expect(
    zfsDeletionSignals([volume], bytes, new Date("2026-10-09T00:59:00Z")),
  ).toEqual([]);
  expect(
    zfsDeletionSignals([volume], [], new Date("2026-10-09T02:00:00Z")),
  ).toEqual([]);
  expect(
    zfsDeletionSignals([volume], bytes, new Date("2026-10-09T02:00:00Z")),
  ).toMatchObject([{ attributes: { referencedBytes: 4096 } }]);
  zfsDeletionSignals([], bytes, new Date("2026-10-09T02:01:00Z"));
  expect(await register.metrics()).not.toContain(
    'zfs_deleting_volume_timestamp_seconds{node="torvalds"',
  );
});

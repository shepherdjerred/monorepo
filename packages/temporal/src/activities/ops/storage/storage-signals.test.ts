import { expect, test } from "vitest";
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

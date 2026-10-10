import { expect, test } from "vitest";
import { KubernetesClient } from "./kubernetes.ts";
import { sequence } from "./test-support/fake-fetch.ts";

function client(items: unknown[]) {
  return new KubernetesClient({
    baseUrl: "https://kubernetes.default.svc",
    token: () => Promise.resolve("test-token"),
    fetch: sequence({ items }).fetch,
  });
}

test("reads partial restore failures and fails on unknown classifications", async () => {
  const restore = {
    metadata: {
      name: "restore",
      namespace: "velero",
      creationTimestamp: "2026-10-09T00:00:00Z",
    },
    spec: { backupName: "full" },
    status: { phase: "PartiallyFailed", errors: 1 },
  };
  expect(await client([restore]).listVeleroRestores()).toMatchObject([
    { phase: "PartiallyFailed", errors: 1, classification: "unclassified" },
  ]);
  await expect(
    client([
      {
        ...restore,
        metadata: {
          ...restore.metadata,
          annotations: {
            "ops.sjer.red/restore-failure-classification": "ignored",
          },
        },
      },
    ]).listVeleroRestores(),
  ).rejects.toThrow();
});

test("lists only deleting volumes with the real node and dataset identity", async () => {
  const volume = {
    metadata: { name: "pvc-ci" },
    spec: { ownerNodeID: "liskov", poolName: "zfspv-pool-nvme" },
  };
  const deletedAt = "2026-10-09T00:00:00Z";
  expect(
    await client([
      volume,
      {
        ...volume,
        metadata: { ...volume.metadata, deletionTimestamp: deletedAt },
      },
    ]).listDeletingZfsVolumes(),
  ).toEqual([
    {
      name: "pvc-ci",
      node: "liskov",
      dataset: "zfspv-pool-nvme/pvc-ci",
      deletedAt,
    },
  ]);
});

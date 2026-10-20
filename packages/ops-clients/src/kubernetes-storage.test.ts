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

test("reads a superseded restore only together with the Restore it names", async () => {
  const restore = {
    metadata: {
      name: "pg18-rehearsal-temporal-full-oct8",
      namespace: "velero",
      creationTimestamp: "2026-10-08T23:10:20Z",
    },
    spec: { backupName: "pg18-preflight-temporal-oct8" },
    status: { phase: "PartiallyFailed", errors: 1 },
  };
  const annotated = (annotations: Record<string, string>) => ({
    ...restore,
    metadata: { ...restore.metadata, annotations },
  });

  expect(
    await client([
      annotated({
        "ops.sjer.red/restore-failure-classification":
          "superseded-by-accepted-restore",
        "ops.sjer.red/superseded-by-restore": "ops-native-full-20261010-v2",
      }),
    ]).listVeleroRestores(),
  ).toMatchObject([
    {
      classification: "superseded-by-accepted-restore",
      supersededBy: "ops-native-full-20261010-v2",
    },
  ]);
  expect(await client([restore]).listVeleroRestores()).toMatchObject([
    { classification: "unclassified", supersededBy: undefined },
  ]);

  for (const annotations of [
    {
      "ops.sjer.red/restore-failure-classification":
        "superseded-by-accepted-restore",
    },
    {
      "ops.sjer.red/restore-failure-classification":
        "superseded-by-accepted-restore",
      "ops.sjer.red/superseded-by-restore": "",
    },
    { "ops.sjer.red/superseded-by-restore": "ops-native-full-20261010-v2" },
  ]) {
    await expect(
      client([annotated(annotations)]).listVeleroRestores(),
    ).rejects.toThrow("ops.sjer.red/superseded-by-restore");
  }
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

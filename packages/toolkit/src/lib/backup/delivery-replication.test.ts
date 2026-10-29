import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { createNarrowReader } from "@shepherdjerred/delivery/client";
import { replicateObject } from "@shepherdjerred/seaweedfs-backup/replicate";
import { InMemoryObjectStore } from "@shepherdjerred/seaweedfs-backup/testing/in-memory-store";
import {
  pendingServiceArtifacts,
  replicateDeliveryArtifact,
} from "./delivery-replication.ts";

const bytes = "verified archive bytes";
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const target = {
  artifactId: "source-1",
  serviceId: "cloudflare-operator",
  digest,
};
const pending = ArtifactVersionSchema.parse({
  id: target.artifactId,
  serviceId: target.serviceId,
  digest,
  buildId: "build-1",
  uri: "s3://delivery-artifacts/source/archive.tar.gz",
  component: "archive:cloudflare-operator",
  kind: "archive",
  version: "commit",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-29T00:00:00.000Z",
});

test("pending artifact lookup follows service-scoped pages beyond the global queue", async () => {
  const seen: string[] = [];
  const read = createNarrowReader({
    baseUrl: "https://delivery.example.test",
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.searchParams.get("serviceId")).toBe(target.serviceId);
      expect(url.searchParams.get("status")).toBe("pending");
      seen.push(url.searchParams.get("cursor") ?? "first");
      return Response.json(
        url.searchParams.has("cursor")
          ? {
              items: [
                {
                  id: "build-1",
                  serviceId: target.serviceId,
                  status: "pending",
                  artifacts: [pending],
                },
              ],
              nextCursor: null,
            }
          : { items: [], nextCursor: "next" },
      );
    },
  });
  expect(await pendingServiceArtifacts(read, target.serviceId)).toEqual([
    pending,
  ]);
  expect(seen).toEqual(["first", "next"]);
});

test("copies and verifies exactly the pending artifact before recording its replica", async () => {
  const source = new InMemoryObjectStore();
  const destination = new InMemoryObjectStore();
  source.createBucket("delivery-artifacts");
  destination.createBucket("backup");
  source.seed("delivery-artifacts", "source/archive.tar.gz", bytes);
  let receiptCount = 0;
  const result = await replicateDeliveryArtifact(
    target,
    {
      pendingForService: async () => [pending],
      recordReplication: async (input) => {
        receiptCount += 1;
        return ArtifactVersionSchema.parse({
          id: target.artifactId,
          component: "archive:cloudflare-operator",
          kind: "archive",
          uri: pending.uri,
          digest,
          version: "commit",
          serviceId: target.serviceId,
          buildId: pending.buildId,
          sourceRevision: "a".repeat(40),
          createdAt: "2026-10-29T00:00:00.000Z",
          replication: input.replication,
        });
      },
    },
    replicateObject,
    { source, destination, backupBucket: "backup" },
  );
  expect(receiptCount).toBe(1);
  expect(result.replication?.digest).toBe(digest);
  expect(result.replication?.key.startsWith("objects/")).toBe(true);
  expect(
    await destination.headObject("backup", result.replication?.key ?? ""),
  ).toBeDefined();
});

test("a mismatched target or changed pending record never records a receipt", async () => {
  const source = new InMemoryObjectStore();
  const destination = new InMemoryObjectStore();
  source.createBucket("delivery-artifacts");
  destination.createBucket("backup");
  source.seed("delivery-artifacts", "source/archive.tar.gz", bytes);
  let reads = 0;
  const client = {
    pendingForService: async () => (++reads === 1 ? [pending] : []),
    recordReplication: async () => {
      throw new Error("must not record");
    },
  };
  await expect(
    replicateDeliveryArtifact(
      { ...target, serviceId: "wrong" },
      client,
      replicateObject,
      { source, destination, backupBucket: "backup" },
    ),
  ).rejects.toThrow("not pending");
  reads = 0;
  await expect(
    replicateDeliveryArtifact(target, client, replicateObject, {
      source,
      destination,
      backupBucket: "backup",
    }),
  ).rejects.toThrow("changed during replication");
});

test("a corrupted replica never receives a Delivery receipt", async () => {
  const source = new InMemoryObjectStore();
  const destination = new InMemoryObjectStore();
  source.createBucket("delivery-artifacts");
  destination.createBucket("backup");
  source.seed("delivery-artifacts", "source/archive.tar.gz", bytes);
  destination.corruptWrites = true;
  let recorded = false;
  await expect(
    replicateDeliveryArtifact(
      target,
      {
        pendingForService: async () => [pending],
        recordReplication: async () => {
          recorded = true;
          throw new Error("unexpected receipt");
        },
      },
      replicateObject,
      { source, destination, backupBucket: "backup" },
    ),
  ).rejects.toThrow();
  expect(recorded).toBe(false);
});

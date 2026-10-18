import { expect, test } from "vitest";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import { minecraftChartForPublication } from "./delivery-upstream-artifacts.ts";

const original = ArtifactVersionSchema.parse({
  id: "upstream/minecraft/original",
  serviceId: "minecraft",
  component: "chart:minecraft",
  kind: "chart",
  buildId: "upstream/original-build",
  version: "5.2.0",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-17T10:00:00.000Z",
  uri: "https://chartmuseum.sjer.red/charts/minecraft-5.2.0.tgz",
  digest: `sha256:${"b".repeat(64)}`,
  origin: {
    kind: "upstream",
    repository: "https://itzg.github.io/minecraft-server-charts/",
    name: "minecraft",
    version: "5.2.0",
    checksum: `sha256:${"b".repeat(64)}`,
  },
});
const producer = {
  repositoryId: 1,
  pipelineNumber: 42,
  sourceRevision: "c".repeat(40),
};
function unexpected(): never {
  throw new Error(
    "Already-qualified original must not depend on upstream or publisher credentials",
  );
}

test("unchanged pin reuses original identity without credentials or upstream availability", async () => {
  const selected = await minecraftChartForPublication(
    {
      latestQualifiedArtifact: async () => original,
      acquireUpstreamArtifact: unexpected,
    },
    "5.2.0",
    producer,
    { credentials: unexpected, mirror: unexpected },
  );
  expect(selected).toBe(original);
  expect(selected.sourceRevision).not.toBe(producer.sourceRevision);
});

test("a missing catalog entry independently acquires the selected bytes once without inventing a current-CI origin", async () => {
  let acquisitions = 0;
  const selected = await minecraftChartForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No original");
      },
      acquireUpstreamArtifact: async (input) => {
        acquisitions++;
        expect(input.artifact.digest).toBe(original.digest);
        expect(input.sourceRevision).toBe(producer.sourceRevision);
        return {
          buildId: original.buildId,
          artifact: original,
          status: "verified",
        };
      },
    },
    original.version,
    producer,
    {
      credentials: () => ({ username: "fixture", password: "fixture" }),
      mirror: async () => ({
        name: "minecraft",
        revision: original.version,
        uri: original.uri,
        digest: original.digest,
        origin:
          original.origin.kind === "upstream" ? original.origin : unexpected(),
      }),
    },
  );
  expect(acquisitions).toBe(1);
  expect(selected).toBe(original);
});

test("a catalog outage and a corrupt original identity fail instead of reacquiring around the contract", async () => {
  await expect(
    minecraftChartForPublication(
      {
        latestQualifiedArtifact: async () => {
          throw new DeliveryClientError(
            503,
            "UNAVAILABLE",
            "Catalog unavailable",
          );
        },
        acquireUpstreamArtifact: unexpected,
      },
      original.version,
      producer,
      { credentials: unexpected, mirror: unexpected },
    ),
  ).rejects.toThrow("Catalog unavailable");
  await expect(
    minecraftChartForPublication(
      {
        latestQualifiedArtifact: async () => ({
          ...original,
          origin: { kind: "first-party" },
        }),
        acquireUpstreamArtifact: unexpected,
      },
      original.version,
      producer,
      { credentials: unexpected, mirror: unexpected },
    ),
  ).rejects.toThrow("reviewed original upstream identity");
});

test.each([{ version: "5.1.0" }, { checksum: `sha256:${"d".repeat(64)}` }])(
  "an inconsistent original upstream receipt is not reused: %j",
  async (change) => {
    if (original.origin.kind !== "upstream") unexpected();
    await expect(
      minecraftChartForPublication(
        {
          latestQualifiedArtifact: async () => ({
            ...original,
            origin: { ...original.origin, ...change },
          }),
          acquireUpstreamArtifact: unexpected,
        },
        original.version,
        producer,
        { credentials: unexpected, mirror: unexpected },
      ),
    ).rejects.toThrow("reviewed original upstream identity");
  },
);

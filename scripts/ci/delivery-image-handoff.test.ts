import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { pushImages } from "../../ci/scripts/images/bake-images.ts";
import { buildPublications } from "./publish-delivery.ts";

const sourceRevision = "c".repeat(40);
const pinnedDigest = `sha256:${"a".repeat(64)}`;
const manifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { digest: `sha256:${"b".repeat(64)}` },
  layers: [],
});
const candidateDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
const reference = `docker.io/shepherdjerred/arcade@${candidateDigest}`;

async function publishCandidate(smokeFails = false) {
  const legacy: Readonly<Record<string, string>>[] = [];
  const delivery: Readonly<Record<string, string>>[] = [];
  const candidates: Readonly<Record<string, string>>[] = [];
  const verified: string[] = [];
  const operation = pushImages(
    {
      targets: ["arcade"],
      commit: sourceRevision,
      buildNumber: "42",
      contractHash: "fixture-contract",
    },
    {
      executor: async (command, environment) => {
        expect(command).toContain("--push");
        expect(environment?.["GIT_SHA"]).toBe(sourceRevision);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      environment: {},
      readVersionCatalog: async () =>
        JSON.stringify({
          schemaVersion: 1,
          entries: [
            {
              name: "shepherdjerred/arcade",
              category: "internal-image",
              artifactType: "image",
              management: { managed: false },
              value: `2.0.0-1@${pinnedDigest}`,
            },
          ],
        }),
      getManifestDigest: async (candidate) => {
        expect(candidate).toBe(
          `docker.io/shepherdjerred/arcade:candidate-${sourceRevision}`,
        );
        return candidateDigest;
      },
      verifyRegistryAccess: async (target, digest) => {
        expect(target).toBe("arcade");
        expect(digest).toBe(candidateDigest);
        verified.push("registry");
      },
      verifySourceLabel: async (image) => {
        expect(image).toBe(reference);
        verified.push("source");
      },
      smokeCandidate: async (target, image) => {
        expect(target).toBe("arcade");
        expect(image).toBe(reference);
        if (smokeFails) throw new Error("Exact candidate smoke failed");
        verified.push("smoke");
      },
      // Build identities differ, but the candidate's application bytes match.
      getRuntimeFingerprint: async () => "identical-runtime",
      writeMetadata: async (digests) => {
        legacy.push(digests);
      },
      writeDeliveryMetadata: async (digests) => {
        expect(verified).toEqual(["registry", "source", "smoke"]);
        delivery.push(digests);
      },
      writeCandidates: async (digests) => {
        candidates.push(digests);
      },
      writeText: () => Promise.resolve(),
    },
  );
  return { operation, legacy, delivery, candidates };
}

test("publishes a freshly verified runtime-unchanged Arcade candidate with its own CI provenance", async () => {
  const output = await publishCandidate();
  await output.operation;
  expect(output.legacy).toEqual([{}]);
  expect(output.candidates).toEqual([{}]);
  expect(output.delivery).toEqual([
    { "shepherdjerred/arcade": candidateDigest },
  ]);
  const [publication] = await buildPublications(
    {
      digests: output.delivery[0],
      charts: [{ name: "arcade", revision: "2.0.0-42" }],
      sourceRevision,
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
      pipelineNumber: 42,
      repositoryId: 1,
      capturedAt: "2026-10-17T00:00:00.000Z",
    },
    {
      inspectImage: async (image) => {
        expect(image).toBe(reference);
        return manifest;
      },
      chartArtifact: async () => ({
        uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-2.0.0-42.tgz",
        digest: `sha256:${"d".repeat(64)}`,
      }),
    },
  );
  expect(publication?.sourceRevision).toBe(sourceRevision);
  expect(publication?.ciUrl).toBe(
    "https://woodpecker.sjer.red/repos/1/pipeline/42",
  );
  expect(publication?.artifacts.map((artifact) => artifact.component)).toEqual([
    "image:arcade",
    "chart:arcade",
  ]);
  expect(publication?.artifacts[0]).toMatchObject({
    id: "ci/1/42/image/arcade",
    digest: candidateDigest,
  });
  expect(publication?.artifacts[0]?.digest).not.toBe(pinnedDigest);
});

test("does not hand off an image whose exact candidate smoke failed", async () => {
  const output = await publishCandidate(true);
  await expect(output.operation).rejects.toThrow(
    "Exact candidate smoke failed",
  );
  expect(output.delivery).toEqual([]);
  expect(output.legacy).toEqual([]);
  expect(output.candidates).toEqual([]);
});

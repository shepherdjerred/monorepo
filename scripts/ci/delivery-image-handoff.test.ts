import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { pushImages } from "../../ci/scripts/images/bake-images.ts";
import { buildPublications } from "./publish-delivery.ts";
import {
  ArtifactVersionSchema,
  type ArtifactVersion,
} from "../../packages/delivery/src/shared/contract.ts";
import {
  CANONICAL_IMAGE_TARGETS,
  chartPublicationImages,
  imageIdentity,
  unbuiltImageOriginals,
} from "../lib/image-pin-catalog.ts";
import { readQualifiedImages } from "../../ci/scripts/images/live-version-catalog.ts";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import { DeliveryClientError as FocusedClientError } from "@shepherdjerred/delivery/client-error";

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

test("production metadata readers use the existing authenticated client and its same public error identity", async () => {
  expect(FocusedClientError).toBe(DeliveryClientError);
  vi.stubEnv("DELIVERY_URL", "https://delivery.example.invalid");
  vi.stubEnv("DELIVERY_API_TOKEN", "synthetic-test-only");
  const paths: string[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
    const url = new URL(input);
    expect(url.origin).toBe("https://delivery.example.invalid");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer synthetic-test-only",
    );
    paths.push(url.pathname);
    return Promise.resolve(
      url.pathname === "/api/v1/overview"
        ? Response.json({
            environments: [],
            deployments: [],
            versionSets: [],
            artifacts: [],
          })
        : Response.json(
            {
              error: {
                code: "NOT_FOUND",
                message: "No qualified original",
                requestId: "test",
              },
            },
            { status: 404 },
          ),
    );
  });
  try {
    expect(await readQualifiedImages()).toEqual(new Map());
    expect(paths).toHaveLength(CANONICAL_IMAGE_TARGETS.length);
    expect(new Set(paths)).toEqual(
      new Set(["/api/v1/artifacts/latest-qualified"]),
    );
    const fresh = Object.fromEntries(
      CANONICAL_IMAGE_TARGETS.map((name) => [
        `shepherdjerred/${name}`,
        pinnedDigest,
      ]),
    );
    expect(
      await chartPublicationImages((key) =>
        Promise.resolve(
          JSON.stringify(key === "delivery-image-digests" ? fresh : []),
        ),
      ),
    ).toEqual({
      ...fresh,
      "shepherdjerred/the-storm-server/candidate": pinnedDigest,
    });
    expect(paths.at(-1)).toBe("/api/v1/overview");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("a new sourceCI retains original image IDs without manufacturing new produced artifacts", async () => {
  const inventory = new Map(
    ["delivery", "tracker"].map((name) => [
      name,
      ArtifactVersionSchema.parse({
        ...imageIdentity(name),
        id: `ci/1/42/image/${name}`,
        buildId: `ci/1/42/${name}`,
        sourceRevision: "a".repeat(40),
        createdAt: "2026-10-17T12:00:00.000Z",
        digest: pinnedDigest,
        version: "2.0.0-1000042",
        origin: { kind: "first-party" },
      }),
    ]),
  );
  const delivery = inventory.get("delivery")!;
  const tracker = inventory.get("tracker")!;
  const builds = await buildPublications(
    {
      digests: {},
      charts: [],
      retainedArtifacts: unbuiltImageOriginals(inventory, []),
      sourceRevision: "c".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/43",
      pipelineNumber: 43,
      repositoryId: 1,
      capturedAt: "2026-10-18T00:00:00.000Z",
    },
    {
      inspectImage: async () => {
        throw new Error("No new image");
      },
      chartArtifact: async () => {
        throw new Error("No new chart");
      },
    },
  );
  expect(
    builds.map((build) => ({
      serviceId: build.serviceId,
      sourceRevision: build.sourceRevision,
      artifacts: build.artifacts,
      retainedArtifactIds: build.retainedArtifactIds,
    })),
  ).toEqual([
    {
      serviceId: "delivery",
      sourceRevision: "c".repeat(40),
      artifacts: [],
      retainedArtifactIds: [delivery.id],
    },
    {
      serviceId: "tracker",
      sourceRevision: "c".repeat(40),
      artifacts: [],
      retainedArtifactIds: [tracker.id],
    },
  ]);
  expect(unbuiltImageOriginals(inventory, ["delivery"])).toEqual([tracker]);
  expect(delivery.buildId).toBe("ci/1/42/delivery");
  expect(delivery.sourceRevision).toBe("a".repeat(40));
});

const arcadeOriginal = ArtifactVersionSchema.parse({
  id: "ci/1/41/image/arcade",
  buildId: "original-arcade-build",
  serviceId: "arcade",
  component: "image:arcade",
  kind: "image",
  uri: "docker.io/shepherdjerred/arcade",
  digest: pinnedDigest,
  version: "2.0.0-1000041",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-17T00:00:00.000Z",
});

async function publishCandidate(smokeFails = false) {
  const delivery: {
    digests: Readonly<Record<string, string>>;
    retained: readonly ArtifactVersion[];
  }[] = [];
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
      readQualifiedImages: async () => new Map([["arcade", arcadeOriginal]]),
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
      writeDeliveryMetadata: async (digests, retained) => {
        expect(verified).toEqual(["registry", "source", "smoke"]);
        delivery.push({ digests, retained });
      },
      writeText: () => Promise.resolve(),
    },
  );
  return { operation, delivery };
}

test("retains the qualified original for a verified runtime-unchanged Arcade candidate", async () => {
  const output = await publishCandidate();
  await output.operation;
  // The rebuilt bytes are never registered; the original keeps its own
  // artifact, build, and source identity under this pipeline's publication.
  expect(output.delivery).toEqual([
    { digests: {}, retained: [arcadeOriginal] },
  ]);
  const [publication] = await buildPublications(
    {
      digests: output.delivery[0]?.digests,
      retainedArtifacts: output.delivery[0]?.retained,
      charts: [
        {
          name: "arcade",
          revision: "2.0.0-42",
          digest: `sha256:${"d".repeat(64)}`,
          contentFingerprint: `sha256:${"e".repeat(64)}`,
        },
      ],
      sourceRevision,
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
      pipelineNumber: 42,
      repositoryId: 1,
      capturedAt: "2026-10-17T00:00:00.000Z",
    },
    {
      inspectImage: async () => {
        throw new Error("A retained image is never inspected as a candidate");
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
    "chart:arcade",
  ]);
  expect(publication?.retainedArtifactIds).toEqual(["ci/1/41/image/arcade"]);
  expect(arcadeOriginal.digest).toBe(pinnedDigest);
  expect(arcadeOriginal.digest).not.toBe(candidateDigest);
});

test("does not hand off an image whose exact candidate smoke failed", async () => {
  const output = await publishCandidate(true);
  await expect(output.operation).rejects.toThrow(
    "Exact candidate smoke failed",
  );
  expect(output.delivery).toEqual([]);
});

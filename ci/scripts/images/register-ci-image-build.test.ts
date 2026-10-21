import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { PublishBuildSchema } from "../../../packages/delivery/src/shared/contract.ts";
import type { PublishBuild } from "../../../packages/delivery/src/shared/contract.ts";
import {
  ciImageBuild,
  registerCiImageBuild,
  type CiBuildContext,
} from "./register-ci-image-build.ts";
import { parseCiImageCandidate } from "./update-ci-image-pin-core.ts";

const childDigest = `sha256:${"1".repeat(64)}`;
const rawManifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { digest: childDigest, platform: { architecture: "amd64", os: "linux" } },
    {
      digest: `sha256:${"2".repeat(64)}`,
      platform: { architecture: "unknown", os: "unknown" },
    },
  ],
});
const digest = `sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;
const sourceCommit = "a".repeat(40);
const context: CiBuildContext = {
  repositoryId: 7,
  pipelineNumber: 4321,
  releaseNumber: 1_004_321,
  sourceRevision: sourceCommit,
  ciUrl: "https://ci.sjer.red/repos/7/pipeline/4321",
  verifiedAt: "2026-10-20T12:00:00.000Z",
};
const candidate = (image = "ci-base", buildNumber = context.releaseNumber) =>
  parseCiImageCandidate({
    schema: "ci-image-candidate/v1",
    image,
    buildNumber,
    sourceCommit,
    sourceFingerprint: `sha256:${"3".repeat(64)}`,
    digest,
  });
const expectedBuild: PublishBuild = {
  requestId: "ci/7/4321/ci/ci-base",
  serviceId: "ci",
  sourceRevision: sourceCommit,
  ciUrl: context.ciUrl,
  verifiedAt: context.verifiedAt,
  artifacts: [
    {
      id: "ci/7/4321/image/ci-base",
      component: "image:ci-base",
      kind: "image",
      uri: "docker.io/shepherdjerred/ci-base",
      digest,
      runtimeDigests: [childDigest],
      requires: {},
      version: "2.0.0-1004321",
    },
  ],
  retainedArtifactIds: [],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.each(["ci-base", "ci-playwright"])(
  "builds the ci service build for %s from the candidate and the pipeline",
  (image) => {
    const build = ciImageBuild(candidate(image), context, rawManifest);
    expect(build).toEqual({
      ...expectedBuild,
      requestId: `ci/7/4321/ci/${image}`,
      artifacts: [
        {
          ...expectedBuild.artifacts[0],
          id: `ci/7/4321/image/${image}`,
          component: `image:${image}`,
          uri: `docker.io/shepherdjerred/${image}`,
        },
      ],
    });
    expect(PublishBuildSchema.parse(build).serviceId).toBe("ci");
  },
);

test("registers the candidate file through the injected client after inspecting its exact manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-image-candidate-"));
  directories.push(directory);
  const candidatePath = path.join(directory, "ci-base-candidate.json");
  await Bun.write(candidatePath, JSON.stringify(candidate()));
  const published: PublishBuild[] = [];
  const inspected: string[] = [];
  const result = await registerCiImageBuild({
    candidatePath,
    context,
    client: {
      publish: async (input) => {
        published.push(input);
        return { buildId: "build/ci-base", artifacts: [input.requestId] };
      },
    },
    inspect: async (reference) => {
      inspected.push(reference);
      return rawManifest;
    },
  });
  expect(result.buildId).toBe("build/ci-base");
  expect(inspected).toEqual([`docker.io/shepherdjerred/ci-base@${digest}`]);
  expect(published).toEqual([expectedBuild]);
});

test.each([
  [
    "a toolchain image outside the ci service",
    () => candidate("windows-cross-compiler"),
    "not a CI service image",
  ],
  [
    "a candidate from another pipeline's release",
    () => candidate("ci-base", context.releaseNumber - 1),
    "is not this pipeline's release 1004321",
  ],
])("refuses %s without registering", async (_, build, reason) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-image-candidate-"));
  directories.push(directory);
  const candidatePath = path.join(directory, "candidate.json");
  await Bun.write(candidatePath, JSON.stringify(build()));
  let published = 0;
  await expect(
    registerCiImageBuild({
      candidatePath,
      context,
      client: {
        publish: async () => {
          published += 1;
          return { buildId: "unexpected", artifacts: [] };
        },
      },
      inspect: async () => rawManifest,
    }),
  ).rejects.toThrow(reason);
  expect(published).toBe(0);
});

test("refuses a candidate built from another commit and a manifest that is not the pushed digest", () => {
  expect(() =>
    ciImageBuild(
      candidate(),
      { ...context, sourceRevision: "b".repeat(40) },
      rawManifest,
    ),
  ).toThrow("differs from this pipeline's commit");
  expect(() => ciImageBuild(candidate(), context, `${rawManifest} `)).toThrow(
    "do not match the published digest",
  );
});

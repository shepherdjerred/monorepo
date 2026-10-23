import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { DeliveryClientError } from "../../../packages/delivery/src/shared/client-error.ts";
import { PublishBuildSchema } from "../../../packages/delivery/src/shared/contract.ts";
import type {
  ArtifactVersion,
  PublishBuild,
} from "../../../packages/delivery/src/shared/contract.ts";
import { CATALOG_CORE } from "../../../packages/ops-model/src/delivery-catalog/core.ts";
import type { CiBuildContext } from "./ci-build-context.ts";
import {
  pinnedCiImages,
  registerCiServiceBuild,
  type CiServiceClient,
  type PinnedCiImage,
} from "./register-ci-service-build.ts";

const manifest = (seed: string) =>
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      {
        digest: `sha256:${seed.repeat(64)}`,
        platform: { architecture: "amd64", os: "linux" },
      },
    ],
  });
const sha256 = (raw: string) =>
  `sha256:${createHash("sha256").update(raw).digest("hex")}`;
const manifests = new Map([
  ["ci-base", manifest("1")],
  ["ci-playwright", manifest("2")],
]);
const pinned = (name: "ci-base" | "ci-playwright"): PinnedCiImage => {
  const raw = manifests.get(name) ?? "";
  return {
    component: `image:${name}`,
    name,
    uri: `docker.io/shepherdjerred/${name}`,
    pin: {
      schema: "ci-image-pin-state/v1",
      buildNumber: name === "ci-base" ? 1_008_905 : 1_008_100,
      sourceCommit: "c".repeat(40),
      sourceFingerprint: `sha256:${"f".repeat(64)}`,
      digest: sha256(raw),
    },
  };
};
const pins = [pinned("ci-base"), pinned("ci-playwright")];
const context: CiBuildContext = {
  repositoryId: 7,
  pipelineNumber: 12_001,
  releaseNumber: 1_012_001,
  sourceRevision: "a".repeat(40),
  ciUrl: "https://ci.sjer.red/repos/7/pipeline/12001",
  verifiedAt: "2026-10-22T03:00:00.000Z",
};

const missing = () =>
  Promise.reject(
    new DeliveryClientError(404, "NOT_FOUND", "Qualified artifact not found"),
  );
const qualified = (
  component: string,
  id: string,
  digest: string,
): ArtifactVersion => ({
  id,
  component,
  kind: "image",
  uri: `docker.io/shepherdjerred/${component.slice("image:".length)}`,
  digest,
  runtimeDigests: [],
  requires: {},
  version: "2.0.0-1",
  origin: { kind: "first-party" },
  serviceId: "ci",
  buildId: `build/${id}`,
  sourceRevision: "b".repeat(40),
  createdAt: "2026-10-20T00:00:00.000Z",
});

/** A Delivery that knows the given latest and previously qualified artifacts. */
function delivery(
  latest: readonly ArtifactVersion[],
  originals: readonly ArtifactVersion[] = [],
) {
  const published: PublishBuild[] = [];
  const client: CiServiceClient = {
    latestQualifiedArtifact: async (query) => {
      expect(query).toEqual({
        serviceId: "ci",
        component: query.component,
        kind: "image",
      });
      return (
        latest.find((entry) => entry.component === query.component) ?? missing()
      );
    },
    findQualifiedArtifact: async (query) =>
      originals.find(
        (entry) =>
          entry.component === query.component &&
          entry.digest === query.digest &&
          query.serviceId === "ci",
      ) ?? missing(),
    publish: async (input) => {
      published.push(input);
      return { buildId: "build/ci-seed", artifacts: [] };
    },
  };
  return { client, published };
}

function inspector() {
  const inspected: string[] = [];
  return {
    inspected,
    inspect: async (reference: string) => {
      inspected.push(reference);
      const name = /shepherdjerred\/([\w-]+)@/u.exec(reference)?.[1] ?? "";
      return manifests.get(name) ?? "";
    },
  };
}

test("the catalog's ci components are exactly the committed CI image pins", async () => {
  const committed = await pinnedCiImages();
  expect(committed.map((image) => image.component)).toEqual([
    "image:ci-base",
    "image:ci-playwright",
  ]);
  for (const image of committed) {
    const digestFile =
      image.name === "ci-base"
        ? "ci/ci-image/DIGEST"
        : "ci/ci-playwright/DIGEST";
    const committedDigest = await Bun.file(
      `${import.meta.dir}/../../../${digestFile}`,
    ).text();
    expect(image.pin.digest).toBe(committedDigest.trim());
    expect(image.uri).toBe(`docker.io/shepherdjerred/${image.name}`);
  }
});

test.each([
  ["image:macos-cross-compiler", "first-party", "Unknown CI image"],
  ["chart:woodpecker", "first-party", "not a first-party image"],
  ["image:ci-base", "acquisition", "not a first-party image"],
] as const)(
  "refuses a ci component %s (%s) that no CI pin produces",
  async (name, producer, reason) => {
    const catalog = structuredClone(CATALOG_CORE);
    const service = catalog.services.find((entry) => entry.id === "ci");
    if (service === undefined) throw new Error("ci service missing");
    service.components = [{ name, producer }];
    await expect(pinnedCiImages(catalog)).rejects.toThrow(reason);
  },
);

test("refuses a pin whose DIGEST disagrees with its STATE.json", async () => {
  const state = JSON.stringify(pinned("ci-base").pin);
  await expect(
    pinnedCiImages(undefined, async (path) =>
      path.endsWith("STATE.json") ? state : `sha256:${"9".repeat(64)}\n`,
    ),
  ).rejects.toThrow("DIGEST and STATE.json disagree");
});

test("a new ci lineage with no qualified artifact registers every pin, read back by digest", async () => {
  const { client, published } = delivery([]);
  const { inspect, inspected } = inspector();
  const result = await registerCiServiceBuild({
    context,
    client,
    inspect,
    pins,
  });
  expect(result?.buildId).toBe("build/ci-seed");
  expect(inspected).toEqual(
    pins.map((image) => `${image.uri}@${image.pin.digest}`),
  );
  expect(published).toEqual([
    {
      requestId: "ci/7/12001/ci/pinned-images",
      serviceId: "ci",
      sourceRevision: context.sourceRevision,
      ciUrl: context.ciUrl,
      verifiedAt: context.verifiedAt,
      artifacts: [
        {
          id: "ci/7/12001/image/ci-base",
          component: "image:ci-base",
          kind: "image",
          uri: "docker.io/shepherdjerred/ci-base",
          digest: pins[0]?.pin.digest,
          runtimeDigests: [`sha256:${"1".repeat(64)}`],
          requires: {},
          version: "2.0.0-1008905",
        },
        {
          id: "ci/7/12001/image/ci-playwright",
          component: "image:ci-playwright",
          kind: "image",
          uri: "docker.io/shepherdjerred/ci-playwright",
          digest: pins[1]?.pin.digest,
          runtimeDigests: [`sha256:${"2".repeat(64)}`],
          requires: {},
          version: "2.0.0-1008100",
        },
      ],
      retainedArtifactIds: [],
    },
  ]);
  expect(PublishBuildSchema.parse(published[0]).serviceId).toBe("ci");
});

test("a pinned digest ci qualified before is retained by its original instead of registered again", async () => {
  const base = pins[0];
  if (base === undefined) throw new Error("pin missing");
  const { client, published } = delivery(
    [],
    [qualified("image:ci-base", "ci/7/11000/image/ci-base", base.pin.digest)],
  );
  const { inspect, inspected } = inspector();
  await registerCiServiceBuild({ context, client, inspect, pins });
  expect(inspected).toEqual([
    `docker.io/shepherdjerred/ci-playwright@${pins[1]?.pin.digest ?? ""}`,
  ]);
  expect(published[0]?.retainedArtifactIds).toEqual([
    "ci/7/11000/image/ci-base",
  ]);
  expect(published[0]?.artifacts.map((artifact) => artifact.component)).toEqual(
    ["image:ci-playwright"],
  );
});

test("a changed pin registers one build that retains the latest qualified sibling", async () => {
  const { client, published } = delivery([
    qualified(
      "image:ci-base",
      "ci/7/11500/image/ci-base",
      `sha256:${"e".repeat(64)}`,
    ),
    qualified(
      "image:ci-playwright",
      "ci/7/11400/image/ci-playwright",
      pins[1]?.pin.digest ?? "",
    ),
  ]);
  const { inspect } = inspector();
  await registerCiServiceBuild({ context, client, inspect, pins });
  expect(published).toHaveLength(1);
  expect(published[0]?.artifacts.map((artifact) => artifact.id)).toEqual([
    "ci/7/12001/image/ci-base",
  ]);
  expect(published[0]?.retainedArtifactIds).toEqual([
    "ci/7/11400/image/ci-playwright",
  ]);
});

test("unchanged pins still register an all-retained build, so Delivery decides between R0 and R2", async () => {
  const { client, published } = delivery(
    pins.map((image) =>
      qualified(image.component, `ci/7/11000/${image.name}`, image.pin.digest),
    ),
  );
  const { inspect, inspected } = inspector();
  await registerCiServiceBuild({ context, client, inspect, pins });
  expect(inspected).toEqual([]);
  expect(published).toHaveLength(1);
  expect(published[0]?.artifacts).toEqual([]);
  expect(published[0]?.retainedArtifactIds).toEqual([
    "ci/7/11000/ci-base",
    "ci/7/11000/ci-playwright",
  ]);
  expect(
    PublishBuildSchema.parse(published[0]).retainedArtifactIds,
  ).toHaveLength(2);
});

test("refuses registry bytes that are not the pinned digest", async () => {
  const { client, published } = delivery([]);
  await expect(
    registerCiServiceBuild({
      context,
      client,
      inspect: async () => manifest("3"),
      pins,
    }),
  ).rejects.toThrow("do not match the published digest");
  expect(published).toEqual([]);
});

test("an unavailable Delivery stops the registration instead of reading as a missing set", async () => {
  const { client, published } = delivery([]);
  await expect(
    registerCiServiceBuild({
      context,
      client: {
        ...client,
        latestQualifiedArtifact: () =>
          Promise.reject(
            new DeliveryClientError(503, "PAUSED", "Delivery is paused"),
          ),
      },
      inspect: inspector().inspect,
      pins,
    }),
  ).rejects.toThrow("Delivery is paused");
  expect(published).toEqual([]);
});

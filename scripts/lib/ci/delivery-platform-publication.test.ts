import { expect, test } from "vitest";
import {
  PublishBuildSchema,
  ArtifactVersionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import {
  attachPlatformPublication,
  changedPlatformStacks,
  platformDependencyClosure,
} from "./delivery-platform-publication.ts";

const files: string[] = [];
const metadata = {
  files,
  sourceRevision: "a".repeat(40),
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  repositoryId: 1,
  pipelineNumber: 42,
  capturedAt: "2026-10-17T10:00:00.000Z",
  rootInventory: undefined,
};
const anchor = async () => "original-qualified-apps";
const chartInputs = new ServiceIndex().rootReleaseCharts();
function fullRootPublication() {
  const builds = new Map<string, ReturnType<typeof PublishBuildSchema.parse>>();
  const inventory = chartInputs.map(({ name }) => ({
    name,
    revision: "2.0.0-1000042",
  }));
  for (const chart of chartInputs) {
    const build =
      builds.get(chart.serviceId) ??
      PublishBuildSchema.parse({
        requestId: `ci/1/42/${chart.serviceId}`,
        serviceId: chart.serviceId,
        sourceRevision: metadata.sourceRevision,
        ciUrl: metadata.ciUrl,
        verifiedAt: metadata.capturedAt,
        artifacts: [],
        retainedArtifactIds: [`original-${chart.serviceId}`],
      });
    build.artifacts.push({
      id: `ci/1/42/chart/${chart.name}`,
      component: `chart:${chart.name}`,
      kind: "chart",
      uri: `https://chartmuseum.sjer.red/charts/${chart.name}-2.0.0-1000042.tgz`,
      digest: `sha256:${"b".repeat(64)}`,
      version: "2.0.0-1000042",
      runtimeDigests: [],
      requires: {},
      origin: { kind: "first-party" },
    });
    build.retainedArtifactIds = [];
    builds.set(chart.serviceId, build);
  }
  return { builds: [...builds.values()], inventory };
}

test("ordinary changes do not invent platform deploys; direct stacks retain their policy", () => {
  expect(changedPlatformStacks(["packages/arcade/src/app.ts"])).toEqual([]);
  expect(
    changedPlatformStacks(["packages/homelab/src/tofu/posthog/main.tf"]),
  ).toEqual(["posthog"]);
  expect(
    changedPlatformStacks(["packages/homelab/src/tofu/openai/main.tf"]),
  ).toEqual(["openai"]);
  expect(
    changedPlatformStacks(["packages/homelab/src/tofu/google/main.tf"]),
  ).toEqual([]);
  expect(
    changedPlatformStacks([
      "packages/homelab/src/tofu/cloudflare-tokens/main.tf",
    ]),
  ).toEqual(["cloudflare-tokens"]);
  expect(changedPlatformStacks(["bun.lock"])).toHaveLength(10);
  expect(changedPlatformStacks(undefined)).toHaveLength(10);
});

test("root and DNS releases freeze the complete ordered dependency closure", () => {
  expect(platformDependencyClosure(false, ["arr"])).toEqual({
    root: false,
    tofuStacks: ["arr", "seaweedfs", "tailscale"],
  });
  expect(platformDependencyClosure(false, ["cloudflare"])).toEqual({
    root: true,
    tofuStacks: ["arr", "cloudflare", "seaweedfs", "tailscale"],
  });
  expect(platformDependencyClosure(true, [])).toEqual({
    root: true,
    tofuStacks: ["arr", "seaweedfs", "tailscale"],
  });
});

test("Tofu-only publication records its genuine new CI build and retains the original qualified anchor", async () => {
  const [build] = await attachPlatformPublication(
    [],
    { ...metadata, files: ["packages/homelab/src/tofu/github/main.tf"] },
    anchor,
  );
  expect(build).toMatchObject({
    requestId: "ci/1/42/gitops",
    sourceRevision: metadata.sourceRevision,
    artifacts: [],
    retainedArtifactIds: ["original-qualified-apps"],
    platformChanges: {
      root: false,
      rootArtifacts: {},
      tofuStacks: ["github"],
      sites: [],
    },
  });
  expect(await attachPlatformPublication([], metadata, anchor)).toEqual([]);
});

test("root inventory uses every exact original artifact ID from this actual coordinated chart producer", async () => {
  const { builds, inventory } = fullRootPublication();
  const result = await attachPlatformPublication(
    builds,
    { ...metadata, rootInventory: inventory },
    () => {
      throw new Error("must use actual apps producer");
    },
  );
  const source = result.find((build) => build.serviceId === "gitops");
  expect(source?.platformChanges?.rootArtifacts).toEqual(
    Object.fromEntries(
      chartInputs.map(({ name }) => [name, `ci/1/42/chart/${name}`]),
    ),
  );
  expect(source?.platformChanges?.tofuStacks).toEqual([
    "arr",
    "seaweedfs",
    "tailscale",
  ]);
  expect(source?.retainedArtifactIds).toEqual([]);
  expect(result).toHaveLength(builds.length);
  const missing = builds.map((build) => ({
    ...build,
    artifacts: build.artifacts.filter(
      (artifact) => artifact.component !== "chart:arcade",
    ),
  }));
  await expect(
    attachPlatformPublication(
      missing,
      { ...metadata, rootInventory: inventory },
      anchor,
    ),
  ).rejects.toThrow("genuine current-CI chart producer receipt for arcade");
  await expect(
    attachPlatformPublication(
      builds,
      {
        ...metadata,
        rootInventory: inventory.map((chart) => ({
          ...chart,
          revision: "wrong",
        })),
      },
      anchor,
    ),
  ).rejects.toThrow("genuine current-CI");
});

test("site prerequisites exclude Scout's combined deployment and keep the exact independent archive ID", async () => {
  const build = (serviceId: string, bucket: string) =>
    PublishBuildSchema.parse({
      requestId: `ci/1/42/${bucket}`,
      serviceId,
      sourceRevision: metadata.sourceRevision,
      ciUrl: metadata.ciUrl,
      verifiedAt: metadata.capturedAt,
      artifacts: [
        {
          id: `archive/${bucket}`,
          component: `site:${bucket}`,
          kind: "archive",
          uri: `s3://delivery-artifacts/${bucket}/archive`,
          digest: `sha256:${"c".repeat(64)}`,
          version: "build-42",
        },
      ],
    });
  const result = await attachPlatformPublication(
    [
      build("static-sites", "sjer-red"),
      build("scout-for-lol", "scout-frontend-beta"),
    ],
    metadata,
    anchor,
  );
  expect(
    result.find((entry) => entry.serviceId === "gitops")?.platformChanges
      ?.sites,
  ).toEqual([
    { environmentId: "static-sites/sjer-red", artifactId: "archive/sjer-red" },
  ]);
  expect(SERVICE_CATALOG.platformDeliveryDelegated).toBe(false);
});

test("a newer root freezes unchanged original site archives so an older queued site can follow its explicit parent", async () => {
  const { builds, inventory } = fullRootPublication();
  const lookups: string[] = [];
  const result = await attachPlatformPublication(
    builds,
    { ...metadata, rootInventory: inventory },
    anchor,
    async (bucket) => {
      lookups.push(bucket);
      return ArtifactVersionSchema.parse({
        id: `original/${bucket}`,
        serviceId: "static-sites",
        buildId: "original-older-ci",
        sourceRevision: "b".repeat(40),
        createdAt: metadata.capturedAt,
        component: `site:${bucket}`,
        kind: "archive",
        uri: `s3://delivery-artifacts/${bucket}/original.tar`,
        digest: `sha256:${"c".repeat(64)}`,
        version: "original-release",
      });
    },
  );
  const sites = result.find((build) => build.serviceId === "gitops")
    ?.platformChanges?.sites;
  expect(sites).toHaveLength(13);
  expect(sites).toContainEqual({
    environmentId: "static-sites/sjer-red",
    artifactId: "original/sjer-red",
  });
  expect(lookups).not.toContain("scout-frontend");
  expect(lookups).not.toContain("scout-frontend-beta");
  await expect(
    attachPlatformPublication(
      builds,
      { ...metadata, rootInventory: inventory },
      anchor,
      async (bucket) =>
        ArtifactVersionSchema.parse({
          id: `wrong/${bucket}`,
          serviceId: "scout-for-lol",
          buildId: "original",
          sourceRevision: "b".repeat(40),
          createdAt: metadata.capturedAt,
          component: `site:${bucket}`,
          kind: "archive",
          uri: `s3://delivery-artifacts/${bucket}/original.tar`,
          digest: `sha256:${"c".repeat(64)}`,
          version: "original",
        }),
    ),
  ).rejects.toThrow("original qualified bucket archive");
});

import { expect, test } from "vitest";
import {
  PublishBuildSchema,
  ArtifactVersionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { V1_STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";
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
  expect(changedPlatformStacks(["bun.lock"])).toHaveLength(11);
  expect(changedPlatformStacks(undefined)).toHaveLength(11);
});

test("a stack's declared external inputs select it like its own directory", () => {
  expect(
    changedPlatformStacks(["packages/homelab/src/domain-registry.json"]),
  ).toEqual(["cloudflare"]);
  expect(changedPlatformStacks(["config/analytics-sites.json"])).toEqual([
    "posthog",
  ]);
  expect(
    changedPlatformStacks(["packages/version-catalog/src/image-registry.json"]),
  ).toEqual(["dockerhub"]);
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
      (artifact) => artifact.component !== "chart:woodpecker",
    ),
  }));
  await expect(
    attachPlatformPublication(
      missing,
      { ...metadata, rootInventory: inventory },
      anchor,
    ),
  ).rejects.toThrow(
    "retained qualified chart at the inventory revision for woodpecker",
  );
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
  ).rejects.toThrow("at the inventory revision");
});

test("a root chart retained from Delivery satisfies the inventory at its exact revision", async () => {
  const { builds, inventory } = fullRootPublication();
  const retainedRevision = "2.0.0-1000030";
  const withoutWoodpecker = builds.map((build) => ({
    ...build,
    artifacts: build.artifacts.filter(
      (artifact) => artifact.component !== "chart:woodpecker",
    ),
  }));
  const rootInventory = inventory.map((chart) =>
    chart.name === "woodpecker"
      ? { ...chart, revision: retainedRevision }
      : chart,
  );
  const fresh = chartInputs.find((chart) => chart.name !== "woodpecker");
  if (fresh === undefined) throw new Error("fixture needs a fresh root chart");
  const result = await attachPlatformPublication(
    withoutWoodpecker,
    {
      ...metadata,
      rootInventory,
      retainedCharts: [
        {
          name: "woodpecker",
          revision: retainedRevision,
          artifactId: "ci/1/30/chart/woodpecker",
        },
        // A fresh receipt at the inventory revision wins over a stale reference.
        {
          name: fresh.name,
          revision: "2.0.0-1000042",
          artifactId: `ci/1/30/chart/${fresh.name}`,
        },
      ],
    },
    anchor,
  );
  const rootArtifacts = result.find((build) => build.serviceId === "gitops")
    ?.platformChanges?.rootArtifacts;
  expect(rootArtifacts?.["woodpecker"]).toBe("ci/1/30/chart/woodpecker");
  expect(rootArtifacts?.[fresh.name]).toBe(`ci/1/42/chart/${fresh.name}`);
  await expect(
    attachPlatformPublication(
      withoutWoodpecker,
      {
        ...metadata,
        rootInventory,
        retainedCharts: [
          {
            name: "woodpecker",
            revision: "2.0.0-1000029",
            artifactId: "ci/1/29/chart/woodpecker",
          },
        ],
      },
      anchor,
    ),
  ).rejects.toThrow("at the inventory revision for woodpecker");
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
  expect(SERVICE_CATALOG.platformDeliveryDelegated).toBe(true);
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

test("a first full root publication needs no retained sites when every active site archive is fresh", async () => {
  const { builds, inventory } = fullRootPublication();
  const artifacts = Object.entries(V1_STATIC_SITE_DESTINATIONS)
    .filter(([, environment]) => environment.startsWith("static-sites/"))
    .map(([bucket]) => ({
      id: `ci/1/42/site/${bucket}`,
      component: `site:${bucket}`,
      kind: "archive",
      uri: `s3://delivery-artifacts/sites/${bucket}/${"c".repeat(64)}.tar`,
      digest: `sha256:${"c".repeat(64)}`,
      version: "build-42",
    }));
  const result = await attachPlatformPublication(
    [
      ...builds,
      PublishBuildSchema.parse({
        requestId: "ci/1/42/static-sites",
        serviceId: "static-sites",
        sourceRevision: metadata.sourceRevision,
        ciUrl: metadata.ciUrl,
        verifiedAt: metadata.capturedAt,
        artifacts,
      }),
    ],
    { ...metadata, rootInventory: inventory },
    anchor,
    async () => {
      throw new Error(
        "No qualified predecessor exists before first publication",
      );
    },
  );
  const sites = result.find((build) => build.serviceId === "gitops")
    ?.platformChanges?.sites;
  expect(sites).toHaveLength(13);
  expect(sites).toContainEqual({
    environmentId: "static-sites/glitter-boys",
    artifactId: "ci/1/42/site/glitter-boys",
  });
});

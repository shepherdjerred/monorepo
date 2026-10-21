import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { VersionCatalogEntrySchema } from "@shepherdjerred/version-catalog";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testPublisher } from "#testing/seed.ts";
import { AcquireUpstreamArtifactSchema } from "#shared/contract.ts";
import { createApp } from "#server/app.ts";
import { createDeliveryClient } from "#shared/client.ts";
import { catalogComponents } from "./upstream-artifact.ts";

const context = useDeliveryFixture();
const bytes = new TextEncoder().encode("independent upstream archive fixture");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const manifest = new TextEncoder().encode(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { digest: `sha256:${"d".repeat(64)}` },
  }),
);
const manifestDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
const REPOSITORY = "https://itzg.github.io/minecraft-server-charts/";
const MIRROR = "https://chartmuseum.sjer.red/charts";
const MANIFEST_URL =
  "https://registry-1.docker.io/v2/library/upstream-image/manifests/1.2.3";
function archiveUrl(version: string) {
  return `https://github.com/itzg/minecraft-server-charts/releases/download/minecraft-${version}/minecraft-${version}.tgz`;
}
/** Test allowlist: the Minecraft chart pinned at the fixture version plus one Docker Hub official image. */
const components = [
  VersionCatalogEntrySchema.parse({
    name: "minecraft",
    category: "upstream",
    artifactType: "helm-chart",
    management: {
      managed: true,
      datasource: "helm",
      registryUrl: "https://itzg.github.io/minecraft-server-charts",
      versioning: "semver",
    },
    value: "4.0.0",
    component: true,
  }),
  VersionCatalogEntrySchema.parse({
    name: "upstream-image",
    category: "upstream",
    artifactType: "image",
    management: {
      managed: true,
      datasource: "docker",
      registryUrl: "https://docker.io",
      versioning: "docker",
    },
    value: `1.2.3@${manifestDigest}`,
    component: true,
  }),
];
const input = AcquireUpstreamArtifactSchema.parse({
  requestId: "upstream/initial",
  serviceId: "minecraft",
  sourceRevision: "a".repeat(40),
  artifact: {
    id: "upstream/minecraft/original",
    component: "chart:minecraft",
    kind: "chart",
    uri: `${MIRROR}/minecraft-4.0.0.tgz`,
    version: "4.0.0",
    digest,
    origin: {
      kind: "upstream",
      repository: REPOSITORY,
      name: "minecraft",
      version: "4.0.0",
      checksum: digest,
    },
  },
});
const imageInput = AcquireUpstreamArtifactSchema.parse({
  requestId: "upstream/image",
  serviceId: "arcade",
  sourceRevision: "c".repeat(40),
  pipeline: { repositoryId: 1, pipelineNumber: 7 },
  artifact: {
    id: "upstream/image/1.2.3",
    component: "image:upstream-image",
    kind: "image",
    uri: "docker.io/upstream-image",
    version: "1.2.3",
    digest: manifestDigest,
    origin: {
      kind: "upstream",
      repository: "https://docker.io",
      name: "upstream-image",
      version: "1.2.3",
      checksum: manifestDigest,
    },
  },
});
const imageQuery = {
  serviceId: "arcade",
  component: "image:upstream-image",
  kind: "image" as const,
  digest: manifestDigest,
  originKind: "upstream" as const,
};
function chartIndex(version: string) {
  return Response.json({
    entries: {
      minecraft: [
        {
          name: "minecraft",
          version,
          digest: digest.slice(7),
          urls: [archiveUrl(version)],
        },
      ],
    },
  });
}
function transport(url: string | URL) {
  return Promise.resolve(
    url.toString().endsWith("index.yaml")
      ? chartIndex("4.0.0")
      : new Response(bytes),
  );
}
/** Docker Hub shape: anonymous manifest reads are challenged, then served with a content digest. */
function registry(served: Uint8Array<ArrayBuffer> = manifest) {
  const requests: { url: string; authorization: string | null }[] = [];
  const serve = async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const href = url.toString();
    requests.push({ url: href, authorization: headers.get("authorization") });
    if (href.startsWith("https://auth.docker.io/token?"))
      return Response.json({ token: "anonymous-pull" });
    if (href !== MANIFEST_URL) throw new Error(`Unexpected request ${href}`);
    if (headers.get("authorization") !== "Bearer anonymous-pull")
      return new Response(null, {
        status: 401,
        headers: {
          "WWW-Authenticate":
            'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/upstream-image:pull"',
        },
      });
    return new Response(served, {
      headers: {
        "Content-Type": "application/vnd.oci.image.manifest.v1+json",
        "Docker-Content-Digest": `sha256:${createHash("sha256").update(served).digest("hex")}`,
      },
    });
  };
  return { requests, transport: serve };
}
async function publish(number: number, retainedArtifactIds: string[]) {
  return context.delivery.publish(
    {
      requestId: `minecraft/ci/${String(number)}`,
      serviceId: "minecraft",
      sourceRevision: String(number).repeat(40).slice(0, 40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(number)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [],
      retainedArtifactIds,
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: number },
  );
}

test("independent acquisitions converge on original upstream identity despite concurrent CI sources and failed unrelated CI", async () => {
  const [first, second] = await Promise.all([
    context.delivery.acquireUpstreamArtifact(input, testPublisher, {
      transport,
      components,
    }),
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/concurrent",
        sourceRevision: "b".repeat(40),
        artifact: { ...input.artifact, id: "caller/proposed/clone" },
      },
      testPublisher,
      { transport, components },
    ),
  ]);
  expect(first.artifact).toEqual(second.artifact);
  expect(first.status).toBe("verified");
  const originalBuild = await context.delivery.build(first.buildId);
  expect(originalBuild).toMatchObject({
    sourceKind: "upstream",
    ciUrl: null,
    repositoryId: null,
    pipelineNumber: null,
  });
  expect(await context.delivery.versions("minecraft")).toHaveLength(0);
  const failed = await publish(2, [first.artifact.id]);
  await context.delivery.qualify(failed.buildId, "failed", testExecutor);
  const retainedBuild = await context.delivery.build(first.buildId);
  expect(retainedBuild.status).toBe("verified");
  const genuine = await publish(3, [first.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  const versions = await context.delivery.versions("minecraft");
  expect(versions).toHaveLength(1);
  expect(versions[0]?.components["chart:minecraft"]).toMatchObject({
    id: first.artifact.id,
    buildId: first.buildId,
    sourceRevision: first.artifact.sourceRevision,
    origin: input.artifact.origin,
  });
  expect(
    await context.cluster.database.artifact.count({
      where: { originKey: { not: null } },
    }),
  ).toBe(1);
});

test("retaining the same original component is an audited CI no-op and manual composition cannot become its automatic base", async () => {
  const acquired = await context.delivery.acquireUpstreamArtifact(
    input,
    testPublisher,
    { transport, components },
  );
  const genuine = await publish(2, [acquired.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  const [original] = await context.delivery.versions("minecraft");
  if (original === undefined) throw new Error("Missing genuine CI version");
  await context.delivery.compose(
    {
      requestId: "manual/upstream-selection",
      serviceId: "minecraft",
      components: { "chart:minecraft": acquired.artifact.id },
    },
    testPublisher,
  );
  const repeated = await publish(3, [acquired.artifact.id]);
  await context.delivery.qualify(repeated.buildId, "verified", testExecutor);
  expect(
    await context.cluster.database.versionSet.count({
      where: { serviceId: "minecraft" },
    }),
  ).toBe(2);
  expect(
    await context.cluster.database.versionSet.findUnique({
      where: { qualifiedBuildId: repeated.buildId },
    }),
  ).toBeNull();
  const selected = await context.delivery.latestQualifiedArtifact(
    { serviceId: "minecraft", component: "chart:minecraft", kind: "chart" },
    1,
  );
  expect(selected.id).toBe(acquired.artifact.id);
});

test("acquisition and exact lookup use real HTTP auth, the committed catalog allowlist, original provenance and independent bytes", async () => {
  // The production allowlist is the catalog itself, so the HTTP path acquires the pinned version.
  const pinned = catalogComponents.find((entry) => entry.name === "minecraft");
  if (pinned === undefined)
    throw new Error("The version catalog no longer pins the Minecraft chart");
  const live = AcquireUpstreamArtifactSchema.parse({
    ...input,
    requestId: "upstream/http",
    pipeline: { repositoryId: 1, pipelineNumber: 5 },
    artifact: {
      ...input.artifact,
      id: `upstream/minecraft/${pinned.value}`,
      uri: `${MIRROR}/minecraft-${pinned.value}.tgz`,
      version: pinned.value,
      origin: { ...input.artifact.origin, version: pinned.value },
    },
  });
  const app = createApp({
    delivery: context.delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    upstreamFetch: (url) =>
      Promise.resolve(
        url.toString().endsWith("index.yaml")
          ? chartIndex(pinned.value)
          : new Response(bytes),
      ),
    peerAddress: () => null,
    qualifyBuild: async () => "verified",
    config: {
      publicOrigin: "http://delivery.test",
      writesEnabled: async () => true,
      enabledEnvironments: async () => [],
      operatorLogins: async () => [],
      trustedProxyAddresses: async () => [],
      machineCredentials: [
        { token: "upstream-test-publisher", principal: testPublisher },
      ],
    },
  });
  const client = createDeliveryClient({
    baseUrl: "http://delivery.test",
    headers: { Authorization: "Bearer upstream-test-publisher" },
    fetch: async (url, init) => app.request(url, init),
  });
  const acquired = await client.acquireUpstreamArtifact(live);
  expect(acquired.status).toBe("verified");
  expect(await context.delivery.build(acquired.buildId)).toMatchObject({
    sourceKind: "upstream",
    ciUrl: null,
    repositoryId: 1,
    pipelineNumber: 5,
  });
  expect(
    await client.findQualifiedArtifact({
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
      digest,
      version: pinned.value,
      originKind: "upstream",
    }),
  ).toEqual(acquired.artifact);
  await expect(
    client.findQualifiedArtifact({
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
      digest: `sha256:${"f".repeat(64)}`,
      version: pinned.value,
      originKind: "upstream",
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    client.acquireUpstreamArtifact({
      ...live,
      requestId: "upstream/foreign-repository",
      pipeline: { repositoryId: 2, pipelineNumber: 5 },
    }),
  ).rejects.toMatchObject({ status: 400, code: "INVALID" });
  let reads = 0;
  await expect(
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/ssrf",
        artifact: { ...input.artifact, uri: "http://127.0.0.1/private" },
      },
      testPublisher,
      {
        transport: async () => {
          reads++;
          return new Response(bytes);
        },
        components,
      },
    ),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(reads).toBe(0);
  await context.delivery.acquireUpstreamArtifact(input, testPublisher, {
    transport,
    components,
  });
  await expect(
    context.delivery.acquireUpstreamArtifact(
      {
        ...input,
        requestId: "upstream/conflict",
        artifact: {
          ...input.artifact,
          digest: `sha256:${"f".repeat(64)}`,
          origin: {
            ...input.artifact.origin,
            kind: "upstream",
            repository: REPOSITORY,
            name: "minecraft",
            version: "4.0.0",
            checksum: `sha256:${"f".repeat(64)}`,
          },
        },
      },
      testPublisher,
      { transport, components },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

test("independent verification rejects corrupt bytes and transient read failures remain honestly pending", async () => {
  await expect(
    context.delivery.acquireUpstreamArtifact(input, testPublisher, {
      transport: async (url) =>
        url.toString().endsWith("index.yaml")
          ? transport(url)
          : new Response("corrupt"),
      components,
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
  const pending = await context.cluster.database.build.findUniqueOrThrow({
    where: { requestId: input.requestId },
  });
  expect(pending.status).toBe("pending");
  expect(await context.delivery.pendingQualification()).toMatchObject({
    builds: [],
  });
  const repaired = await context.delivery.acquireUpstreamArtifact(
    input,
    testPublisher,
    { transport, components },
  );
  expect(repaired.status).toBe("verified");
});

test("a chart acquired at its upstream archive URL carries the acquiring pipeline and is found only for that repository", async () => {
  const requested: string[] = [];
  const direct = {
    ...input,
    requestId: "upstream/direct",
    pipeline: { repositoryId: 1, pipelineNumber: 9 },
    artifact: {
      ...input.artifact,
      id: "upstream/minecraft/4.0.0/direct",
      uri: archiveUrl("4.0.0"),
    },
  };
  const acquired = await context.delivery.acquireUpstreamArtifact(
    direct,
    testPublisher,
    {
      transport: (url) => {
        requested.push(url.toString());
        return transport(url);
      },
      components,
    },
  );
  expect(acquired.status).toBe("verified");
  expect(acquired.artifact.uri).toBe(archiveUrl("4.0.0"));
  expect(requested).toEqual([`${REPOSITORY}index.yaml`, archiveUrl("4.0.0")]);
  expect(await context.delivery.build(acquired.buildId)).toMatchObject({
    sourceKind: "upstream",
    ciUrl: null,
    repositoryId: 1,
    pipelineNumber: 9,
  });
  const query = {
    serviceId: "minecraft",
    component: "chart:minecraft",
    kind: "chart" as const,
    digest,
    originKind: "upstream" as const,
  };
  expect(await context.delivery.findQualifiedArtifact(query, 1)).toEqual(
    acquired.artifact,
  );
  await expect(
    context.delivery.findQualifiedArtifact(query, 2),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const genuine = await publish(10, [acquired.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  const [version] = await context.delivery.versions("minecraft");
  expect(version?.components["chart:minecraft"]?.id).toBe(acquired.artifact.id);
});

test("an image is acquired by resolving the pinned tag through the registry's anonymous bearer challenge without downloading bytes", async () => {
  const { requests, transport: registryTransport } = registry();
  const acquired = await context.delivery.acquireUpstreamArtifact(
    imageInput,
    testPublisher,
    { transport: registryTransport, components },
  );
  expect(acquired.status).toBe("verified");
  expect(acquired.artifact).toMatchObject({
    id: imageInput.artifact.id,
    serviceId: "arcade",
    uri: "docker.io/upstream-image",
    digest: manifestDigest,
    origin: imageInput.artifact.origin,
  });
  expect(await context.delivery.build(acquired.buildId)).toMatchObject({
    sourceKind: "upstream",
    ciUrl: null,
    repositoryId: 1,
    pipelineNumber: 7,
  });
  expect(requests.map((request) => request.url)).toEqual([
    MANIFEST_URL,
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fupstream-image%3Apull",
    MANIFEST_URL,
  ]);
  expect(requests[1]?.authorization).toBeNull();
  const replay = await context.delivery.acquireUpstreamArtifact(
    imageInput,
    testPublisher,
    { transport: registryTransport, components },
  );
  expect(replay).toEqual(acquired);
  expect(requests).toHaveLength(3);
  expect(await context.delivery.findQualifiedArtifact(imageQuery, 1)).toEqual(
    acquired.artifact,
  );
});

test("a manifest whose digest differs from the catalog pin is refused and the acquisition stays pending", async () => {
  const { transport: registryTransport } = registry(
    new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, tampered: 1 })),
  );
  await expect(
    context.delivery.acquireUpstreamArtifact(imageInput, testPublisher, {
      transport: registryTransport,
      components,
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
  const pending = await context.cluster.database.build.findUniqueOrThrow({
    where: { requestId: imageInput.requestId },
  });
  expect(pending.status).toBe("pending");
  await expect(
    context.delivery.findQualifiedArtifact(imageQuery, 1),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("services and components outside the catalog allowlist are refused before any read", async () => {
  let reads = 0;
  const counting = {
    transport: async () => {
      reads++;
      return new Response(bytes);
    },
    components,
  };
  const chart = input.artifact;
  const chartOrigin = chart.origin;
  const image = imageInput.artifact;
  const cases = [
    {
      ...input,
      requestId: "refused/chart-name",
      artifact: {
        ...chart,
        component: "chart:mc-router",
        origin: { ...chartOrigin, name: "mc-router" },
      },
    },
    { ...input, requestId: "refused/chart-owner", serviceId: "arcade" },
    { ...input, requestId: "refused/service", serviceId: "not-a-service" },
    {
      ...input,
      requestId: "refused/chart-version",
      artifact: {
        ...chart,
        version: "4.0.1",
        origin: { ...chartOrigin, version: "4.0.1" },
      },
    },
    {
      ...input,
      requestId: "refused/chart-repository",
      artifact: {
        ...chart,
        origin: { ...chartOrigin, repository: "https://example.com/charts/" },
      },
    },
    {
      ...imageInput,
      requestId: "refused/image-uri",
      artifact: { ...image, uri: "docker.io/library/upstream-image" },
    },
    {
      ...imageInput,
      requestId: "refused/image-registry",
      artifact: {
        ...image,
        origin: { ...image.origin, repository: "https://ghcr.io" },
      },
    },
    {
      ...imageInput,
      requestId: "refused/image-component",
      artifact: { ...image, component: "image:other" },
    },
  ];
  for (const refused of cases)
    await expect(
      context.delivery.acquireUpstreamArtifact(
        refused,
        testPublisher,
        counting,
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
  expect(reads).toBe(0);
  expect(await context.cluster.database.build.count()).toBe(1);
});

test("existing mirror-URI rows without a pipeline stay findable for any configured repository and retainable", async () => {
  const mirrored = await context.delivery.acquireUpstreamArtifact(
    input,
    testPublisher,
    { transport, components },
  );
  expect(await context.delivery.build(mirrored.buildId)).toMatchObject({
    repositoryId: null,
    pipelineNumber: null,
  });
  const query = {
    serviceId: "minecraft",
    component: "chart:minecraft",
    kind: "chart" as const,
    digest,
    version: "4.0.0",
    originKind: "upstream" as const,
  };
  for (const repositoryId of [1, 2])
    expect(
      await context.delivery.findQualifiedArtifact(query, repositoryId),
    ).toEqual(mirrored.artifact);
  const genuine = await publish(4, [mirrored.artifact.id]);
  await context.delivery.qualify(genuine.buildId, "verified", testExecutor);
  expect(
    await context.delivery.latestQualifiedArtifact(
      { serviceId: "minecraft", component: "chart:minecraft", kind: "chart" },
      1,
    ),
  ).toEqual(mirrored.artifact);
  const foreign = await context.delivery.acquireUpstreamArtifact(
    { ...imageInput, pipeline: { repositoryId: 2, pipelineNumber: 1 } },
    testPublisher,
    { transport: registry().transport, components },
  );
  expect(foreign.status).toBe("verified");
  await expect(
    context.delivery.findQualifiedArtifact(imageQuery, 1),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await context.delivery.findQualifiedArtifact(imageQuery, 2)).toEqual(
    foreign.artifact,
  );
});

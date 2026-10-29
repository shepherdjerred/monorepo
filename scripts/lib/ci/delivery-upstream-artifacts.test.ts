import { createHash } from "node:crypto";
import { packTar } from "modern-tar";
import { expect, test } from "vitest";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import { sourceArchiveUri } from "@shepherdjerred/delivery/artifact-contract";
import type { AcquireUpstreamArtifact } from "@shepherdjerred/delivery/contract";
import {
  AcquireUpstreamArtifactSchema,
  ArtifactVersionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  catalogComponentName,
  componentEntries,
  parseVersionCatalog,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import rawVersionCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { CATALOG_CORE } from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import {
  componentArtifactsForPublication,
  MIRRORED_CHARTS,
  v1AcquisitionCatalog,
} from "./delivery-upstream-artifacts.ts";

const repository = "https://itzg.github.io/minecraft-server-charts/";
const imageDigest = `sha256:${"e".repeat(64)}`;
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
    repository,
    name: "minecraft",
    version: "5.2.0",
    checksum: `sha256:${"b".repeat(64)}`,
  },
});
const originalImage = ArtifactVersionSchema.parse({
  id: "upstream/itzg/minecraft-server/original",
  serviceId: "minecraft",
  component: "image:itzg/minecraft-server",
  kind: "image",
  buildId: "upstream/original-image-build",
  version: "2026.1.0",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-17T10:00:00.000Z",
  uri: "docker.io/itzg/minecraft-server",
  digest: imageDigest,
  origin: {
    kind: "upstream",
    repository: "https://docker.io",
    name: "itzg/minecraft-server",
    version: "2026.1.0",
    checksum: imageDigest,
  },
});
const producer = {
  repositoryId: 1,
  pipelineNumber: 42,
  sourceRevision: "c".repeat(40),
};
const minecraftChart: VersionCatalogEntry = {
  name: "minecraft",
  category: "upstream",
  artifactType: "helm-chart",
  management: {
    managed: true,
    datasource: "helm",
    // The catalog pins the repository without a trailing slash.
    registryUrl: "https://itzg.github.io/minecraft-server-charts",
    versioning: "semver",
  },
  value: "5.2.0",
  component: true,
};
const minecraftImage: VersionCatalogEntry = {
  name: "itzg/minecraft-server",
  category: "upstream",
  artifactType: "image",
  management: {
    managed: true,
    datasource: "docker",
    registryUrl: "https://docker.io",
    versioning: "docker",
  },
  value: `2026.1.0@${imageDigest}`,
  component: true,
};
const nonComponent: VersionCatalogEntry = {
  name: "cert-manager",
  category: "upstream",
  artifactType: "helm-chart",
  management: { managed: false },
  value: "0.9.0",
};
const catalog = (...entries: VersionCatalogEntry[]) =>
  parseVersionCatalog({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [nonComponent, ...entries],
  });
function unexpected(): never {
  throw new Error(
    "Already-qualified original must not depend on upstream or publisher credentials",
  );
}
const credentials = () => ({ username: "fixture", password: "fixture" });
function verified(input: AcquireUpstreamArtifact) {
  return {
    buildId: "upstream/acquired-build",
    artifact: ArtifactVersionSchema.parse({
      ...input.artifact,
      serviceId: input.serviceId,
      buildId: "upstream/acquired-build",
      sourceRevision: input.sourceRevision,
      createdAt: "2026-10-18T10:00:00.000Z",
    }),
    status: "verified" as const,
  };
}

test("only the Minecraft chart is still mirrored", () => {
  expect([...MIRRORED_CHARTS]).toEqual(["minecraft"]);
});

test("unchanged pins reuse original identities without credentials, upstream availability or the Delivery pipeline key", async () => {
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async (query) =>
        query.kind === "chart" ? original : originalImage,
      acquireUpstreamArtifact: unexpected,
    },
    catalog(minecraftChart, minecraftImage),
    producer,
    {
      credentials: unexpected,
      mirror: unexpected,
      imageOwners: { "itzg/minecraft-server": "minecraft" },
    },
  );
  expect(selected).toEqual([original, originalImage]);
  expect(selected[0]?.sourceRevision).not.toBe(producer.sourceRevision);
});

test("an absent or outdated chart is acquired once through this pipeline with the Minecraft mirror", async () => {
  const requests: AcquireUpstreamArtifact[] = [];
  const mirrors: { name: string; repository: string; mirror: boolean }[] = [];
  const outdated = { ...original, version: "5.1.0" };
  for (const latest of [
    async () => {
      throw new DeliveryClientError(404, "NOT_FOUND", "No original");
    },
    async () => outdated,
  ]) {
    const selected = await componentArtifactsForPublication(
      {
        latestQualifiedArtifact: latest,
        acquireUpstreamArtifact: async (input) => {
          requests.push(input);
          return verified(input);
        },
      },
      catalog(minecraftChart),
      producer,
      {
        credentials,
        mirror: async (intent, options) => {
          mirrors.push({
            name: intent.name,
            repository: intent.repository,
            mirror: options.mirror,
          });
          return {
            name: "minecraft",
            revision: intent.version,
            uri: original.uri,
            digest: original.digest,
            origin:
              original.origin.kind === "upstream"
                ? original.origin
                : unexpected(),
          };
        },
      },
    );
    expect(selected.map((artifact) => artifact.digest)).toEqual([
      original.digest,
    ]);
  }
  expect(mirrors).toEqual([
    { name: "minecraft", repository, mirror: true },
    { name: "minecraft", repository, mirror: true },
  ]);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual({
    requestId: "ci/1/42/acquire/minecraft/5.2.0",
    serviceId: "minecraft",
    sourceRevision: producer.sourceRevision,
    pipeline: { repositoryId: 1, pipelineNumber: 42 },
    artifact: {
      id: `upstream/minecraft/5.2.0/${"b".repeat(64)}`,
      component: "chart:minecraft",
      kind: "chart",
      uri: original.uri,
      digest: original.digest,
      version: "5.2.0",
      origin: original.origin,
    },
  });
});

async function chartTransport(name: string, version: string, mirror: boolean) {
  const body = `name: ${name}\nversion: ${version}\n`;
  const bytes = Bun.gzipSync(
    await packTar([
      {
        header: {
          name: `${name}/Chart.yaml`,
          type: "file",
          size: Buffer.byteLength(body),
        },
        body,
      },
    ]),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  const index = `https://charts.example.test/${name}/`;
  const archive = `${index}${name}-${version}.tgz`;
  const urls: string[] = [];
  const transport = async (url: string | URL, init?: RequestInit) => {
    const location = String(url);
    urls.push(`${init?.method ?? "GET"} ${location}`);
    if (location === `${index}index.yaml`)
      return Response.json({
        entries: { [name]: [{ name, version, digest, urls: [archive] }] },
      });
    if (location === archive) return new Response(bytes);
    if (
      mirror &&
      location === `https://chartmuseum.sjer.red/charts/${name}-${version}.tgz`
    )
      return new Response(bytes);
    throw new Error(`Unexpected request ${location}`);
  };
  return { index, archive, digest: `sha256:${digest}`, transport, urls };
}

test.each([
  ["minecraft", true],
  ["mc-router", false],
])(
  "a chart acquisition reads the catalog repository index through the injected transport (%s mirrored: %s)",
  async (name, mirrored) => {
    const fixture = await chartTransport(name, "1.2.3", mirrored);
    const requests: AcquireUpstreamArtifact[] = [];
    const [selected] = await componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => {
          throw new DeliveryClientError(404, "NOT_FOUND", "No original");
        },
        acquireUpstreamArtifact: async (input) => {
          requests.push(input);
          return verified(input);
        },
      },
      catalog({
        ...minecraftChart,
        name,
        value: "1.2.3",
        management: {
          managed: true,
          datasource: "helm",
          registryUrl: fixture.index.slice(0, -1),
          versioning: "semver",
        },
      }),
      producer,
      { credentials, transport: fixture.transport },
    );
    expect(selected?.serviceId).toBe("minecraft");
    expect(requests[0]?.artifact).toEqual({
      id: `upstream/${name}/1.2.3/${fixture.digest.slice(7)}`,
      component: `chart:${name}`,
      kind: "chart",
      uri: mirrored
        ? `https://chartmuseum.sjer.red/charts/${name}-1.2.3.tgz`
        : fixture.archive,
      digest: fixture.digest,
      version: "1.2.3",
      origin: {
        kind: "upstream",
        repository: fixture.index,
        name,
        version: "1.2.3",
        checksum: fixture.digest,
      },
    });
    expect(
      fixture.urls.some((url) => url.includes("chartmuseum.sjer.red")),
    ).toBe(mirrored);
    expect(fixture.urls.every((url) => url.startsWith("GET "))).toBe(true);
  },
);

test("an image component is acquired from the catalog pin without any network access", async () => {
  const requests: AcquireUpstreamArtifact[] = [];
  const retagged = {
    ...originalImage,
    digest: `sha256:${"f".repeat(64)}`,
    origin: { ...originalImage.origin, checksum: `sha256:${"f".repeat(64)}` },
  };
  for (const latest of [
    async () => {
      throw new DeliveryClientError(404, "NOT_FOUND", "No original");
    },
    // The same tag re-pinned to different bytes is a new acquisition.
    async () => retagged,
  ]) {
    const [selected] = await componentArtifactsForPublication(
      {
        latestQualifiedArtifact: latest,
        acquireUpstreamArtifact: async (input) => {
          requests.push(input);
          return verified(input);
        },
      },
      catalog(minecraftImage),
      producer,
      {
        credentials: unexpected,
        mirror: unexpected,
        transport: unexpected,
        imageOwners: { "itzg/minecraft-server": "minecraft" },
      },
    );
    expect(selected?.digest).toBe(imageDigest);
  }
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual({
    requestId: "ci/1/42/acquire/itzg/minecraft-server/2026.1.0",
    serviceId: "minecraft",
    sourceRevision: producer.sourceRevision,
    pipeline: { repositoryId: 1, pipelineNumber: 42 },
    artifact: {
      id: `upstream/itzg/minecraft-server/2026.1.0/${"e".repeat(64)}`,
      component: "image:itzg/minecraft-server",
      kind: "image",
      uri: "docker.io/itzg/minecraft-server",
      digest: imageDigest,
      version: "2026.1.0",
      origin: originalImage.origin,
    },
  });
});

test("an image component without a declared Delivery owner is refused before any request", async () => {
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: unexpected,
        acquireUpstreamArtifact: unexpected,
      },
      catalog(minecraftImage),
      producer,
      { credentials: unexpected, imageOwners: { other: "minecraft" } },
    ),
  ).rejects.toThrow("itzg/minecraft-server has no Delivery owner");
});

test("a chart without a service catalog owner is refused", async () => {
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: unexpected,
        acquireUpstreamArtifact: unexpected,
      },
      catalog({ ...minecraftChart, name: "unowned-chart" }),
      producer,
      { credentials: unexpected },
    ),
  ).rejects.toThrow("unowned-chart requires a service catalog owner");
});

test("a catalog outage, a corrupt original identity and an unverified acquisition fail instead of publishing around the contract", async () => {
  await expect(
    componentArtifactsForPublication(
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
      catalog(minecraftChart),
      producer,
      { credentials: unexpected, mirror: unexpected },
    ),
  ).rejects.toThrow("Catalog unavailable");
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => ({
          ...original,
          origin: { kind: "first-party" },
        }),
        acquireUpstreamArtifact: unexpected,
      },
      catalog(minecraftChart),
      producer,
      { credentials: unexpected, mirror: unexpected },
    ),
  ).rejects.toThrow("reviewed original upstream identity");
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => {
          throw new DeliveryClientError(404, "NOT_FOUND", "No original");
        },
        acquireUpstreamArtifact: async (input) => ({
          ...verified(input),
          status: "pending",
        }),
      },
      catalog(minecraftImage),
      producer,
      {
        credentials: unexpected,
        imageOwners: { "itzg/minecraft-server": "minecraft" },
      },
    ),
  ).rejects.toThrow("acquisition is pending");
});

test.each([
  { version: "5.1.0" },
  { checksum: `sha256:${"d".repeat(64)}` },
  { repository: "https://charts.example.test/" },
  { name: "other" },
])(
  "an inconsistent original upstream receipt is not reused: %j",
  async (change) => {
    if (original.origin.kind !== "upstream") unexpected();
    await expect(
      componentArtifactsForPublication(
        {
          latestQualifiedArtifact: async () => ({
            ...original,
            origin: { ...original.origin, ...change },
          }),
          acquireUpstreamArtifact: unexpected,
        },
        catalog(minecraftChart),
        producer,
        { credentials: unexpected, mirror: unexpected },
      ),
    ).rejects.toThrow("reviewed original upstream identity");
  },
);

const busybox: VersionCatalogEntry = {
  name: "library/busybox",
  category: "upstream",
  artifactType: "image",
  management: {
    managed: true,
    datasource: "docker",
    registryUrl: "https://docker.io",
    versioning: "docker",
  },
  value: `1.37.0@${imageDigest}`,
  component: true,
};

test("v1 acquires only the Minecraft chart until the window's catalog flip", () => {
  expect(
    componentEntries(
      v1AcquisitionCatalog(catalog(minecraftChart, minecraftImage, busybox)),
    ).map((entry) => entry.name),
  ).toEqual(["minecraft"]);
});

test("v2 acquires an OCI chart from its registry by digest, with no Helm index or mirror", async () => {
  const kueue = parseVersionCatalog(rawVersionCatalog).entries.find(
    (entry) => entry.name === "kueue",
  );
  if (kueue === undefined) throw new Error("Kueue chart entry missing");
  const requests: AcquireUpstreamArtifact[] = [];
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No original");
      },
      acquireUpstreamArtifact: async (input) => {
        requests.push(input);
        return verified(input);
      },
    },
    catalog(kueue),
    producer,
    {
      credentials: unexpected,
      mirror: unexpected,
      transport: unexpected,
      registry: "v2",
    },
  );
  const [pinnedVersion = "", digest = ""] = kueue.value.split("@");
  expect(selected.map((artifact) => artifact.serviceId)).toEqual(["kueue"]);
  expect(requests.map((request) => request.artifact)).toEqual([
    expect.objectContaining({
      component: "chart:kueue",
      kind: "chart",
      uri: "oci://registry.k8s.io/kueue/charts/kueue",
      digest,
      version: pinnedVersion,
      origin: {
        kind: "upstream",
        repository: "https://registry.k8s.io",
        name: "kueue/charts/kueue",
        version: pinnedVersion,
        checksum: digest,
      },
    }),
  ]);
});

test("v2 registers one acquisition under every catalog service that acquires the component", async () => {
  const requests: AcquireUpstreamArtifact[] = [];
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No original");
      },
      acquireUpstreamArtifact: async (input) => {
        requests.push(input);
        return verified(input);
      },
    },
    catalog(busybox),
    producer,
    { credentials, registry: "v2" },
  );
  expect(
    selected.map((artifact) => [artifact.serviceId, artifact.component]),
  ).toEqual([
    ["minecraft-shuxin", "image:busybox"],
    ["minecraft-sjerred", "image:busybox"],
  ]);
  expect(requests.map((request) => request.requestId)).toEqual([
    "ci/1/42/acquire/minecraft-shuxin/library/busybox/1.37.0",
    "ci/1/42/acquire/minecraft-sjerred/library/busybox/1.37.0",
  ]);
  expect(new Set(requests.map((request) => request.artifact.id)).size).toBe(2);
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: unexpected,
        acquireUpstreamArtifact: unexpected,
      },
      catalog({ ...busybox, name: "library/not-in-the-catalog" }),
      producer,
      { credentials, registry: "v2" },
    ),
  ).rejects.toThrow("has no acquiring catalog service");
});

test("v2 acquires an aliased image from its repository under the alias's component", async () => {
  const java8 = parseVersionCatalog(rawVersionCatalog).entries.find(
    (entry) => entry.name === "itzg/minecraft-server-java8",
  );
  if (java8 === undefined) throw new Error("Java 8 Minecraft image missing");
  const requests: AcquireUpstreamArtifact[] = [];
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No original");
      },
      acquireUpstreamArtifact: async (input) => {
        requests.push(input);
        return verified(input);
      },
    },
    catalog(java8),
    producer,
    { credentials, registry: "v2" },
  );
  expect(selected.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.artifact.component).toBe("image:minecraft-server-java8");
    expect(request.artifact.uri).toBe("docker.io/itzg/minecraft-server");
    expect(request.artifact.origin).toMatchObject({
      repository: "https://docker.io",
      name: "itzg/minecraft-server",
    });
  }
});

test("the version catalog's components are exactly the charts, images and Git sources catalog services acquire", () => {
  const components = componentEntries(
    parseVersionCatalog(rawVersionCatalog),
  ).map((entry) => catalogComponentName(entry));
  expect(new Set(components).size).toBe(components.length);
  const acquired = new Set(
    CATALOG_CORE.services.flatMap((service) =>
      service.components
        .filter(
          (component) =>
            component.producer === "acquisition" &&
            /^(?:chart|image|archive):/u.test(component.name) &&
            // The forum bundle is acquired from its release by
            // delivery-forum-publication.ts, not from the version catalog.
            component.name !== "archive:forum-bundle",
        )
        .map((component) => component.name),
    ),
  );
  expect([...components].sort()).toEqual([...acquired].sort());
});

const cloudflareSource = parseVersionCatalog(rawVersionCatalog).entries.find(
  (entry) => entry.name === "adyanth/cloudflare-operator",
);
const sourceCommit = "6".repeat(40);

test("an independently qualified exact source can be reused before a complete version set exists", async () => {
  if (cloudflareSource === undefined) throw new Error("source entry missing");
  const bytes = "verified source bytes";
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const exact = ArtifactVersionSchema.parse({
    ...acquiredSourceVersion(sourceCommit),
    digest,
    uri: sourceArchiveUri("adyanth/cloudflare-operator", digest),
    origin: { ...acquiredSourceVersion(sourceCommit).origin, checksum: digest },
  });
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "no set");
      },
      findQualifiedArtifact: async (query) => {
        expect(query).toMatchObject({
          digest,
          version: sourceCommit,
          originKind: "upstream",
        });
        return exact;
      },
      acquireUpstreamArtifact: unexpected,
    },
    catalog(cloudflareSource),
    producer,
    {
      credentials: unexpected,
      registry: "v2",
      sourceTransport: async (url) =>
        new Response(
          url.startsWith("https://api.github.com/") ? sourceCommit : bytes,
        ),
      publishArchive: unexpected,
    },
  );
  expect(selected).toEqual([exact]);
});

test("v2 acquires a GitHub source as the tarball of its tag's commit, stored by digest", async () => {
  if (cloudflareSource === undefined)
    throw new Error("cloudflare-operator source entry missing");
  const tarball = new TextEncoder().encode("commit tarball bytes");
  const digest = `sha256:${createHash("sha256").update(tarball).digest("hex")}`;
  const reads: { url: string; authorization: string | null }[] = [];
  const stored: { uri: string; digest: string; bytes: string }[] = [];
  const requests: AcquireUpstreamArtifact[] = [];
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No original");
      },
      findQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "No exact source");
      },
      acquireUpstreamArtifact: async (input) => {
        requests.push(input);
        return verified(input);
      },
    },
    catalog(cloudflareSource),
    producer,
    {
      credentials: unexpected,
      mirror: unexpected,
      transport: unexpected,
      registry: "v2",
      githubToken: () => "fixture-token",
      sourceTransport: async (url, init) => {
        reads.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return url.startsWith("https://api.github.com/")
          ? new Response(`${sourceCommit}\n`)
          : new Response(tarball);
      },
      publishArchive: async (input) => {
        stored.push({
          uri: input.uri,
          digest: input.digest,
          bytes: await Bun.file(input.file).text(),
        });
      },
    },
  );
  // Only GitHub's API is read with the token; the tarball is public.
  expect(reads).toEqual([
    {
      url: `https://api.github.com/repos/adyanth/cloudflare-operator/commits/${cloudflareSource.value}`,
      authorization: "Bearer fixture-token",
    },
    {
      url: `https://codeload.github.com/adyanth/cloudflare-operator/tar.gz/${sourceCommit}`,
      authorization: null,
    },
  ]);
  const uri = sourceArchiveUri("adyanth/cloudflare-operator", digest);
  expect(stored).toEqual([{ uri, digest, bytes: "commit tarball bytes" }]);
  expect(
    selected.map((artifact) => [artifact.serviceId, artifact.component]),
  ).toEqual([["cloudflare-operator", "archive:cloudflare-operator"]]);
  expect(
    requests.map(
      (request) => AcquireUpstreamArtifactSchema.parse(request).artifact,
    ),
  ).toEqual([
    expect.objectContaining({
      component: "archive:cloudflare-operator",
      kind: "archive",
      uri,
      digest,
      version: sourceCommit,
      origin: {
        kind: "upstream",
        repository: "https://github.com/adyanth/cloudflare-operator",
        name: "adyanth/cloudflare-operator",
        version: cloudflareSource.value,
        commit: sourceCommit,
        checksum: digest,
      },
    }),
  ]);
});

test("an exact-source authorization error fails instead of uploading or registering", async () => {
  if (cloudflareSource === undefined) throw new Error("source entry missing");
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => {
          throw new DeliveryClientError(404, "NOT_FOUND", "no set");
        },
        findQualifiedArtifact: async () => {
          throw new DeliveryClientError(403, "FORBIDDEN", "denied");
        },
        acquireUpstreamArtifact: unexpected,
      },
      catalog(cloudflareSource),
      producer,
      {
        credentials: unexpected,
        registry: "v2",
        sourceTransport: async (url) =>
          new Response(
            url.startsWith("https://api.github.com/") ? sourceCommit : "source",
          ),
        publishArchive: unexpected,
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
});

test("an exact lookup returning a foreign artifact fails closed", async () => {
  if (cloudflareSource === undefined) throw new Error("source entry missing");
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => {
          throw new DeliveryClientError(404, "NOT_FOUND", "no set");
        },
        findQualifiedArtifact: async () => acquiredSourceVersion(sourceCommit),
        acquireUpstreamArtifact: unexpected,
      },
      catalog(cloudflareSource),
      producer,
      {
        credentials: unexpected,
        registry: "v2",
        sourceTransport: async (url) =>
          new Response(
            url.startsWith("https://api.github.com/")
              ? sourceCommit
              : "different bytes",
          ),
        publishArchive: unexpected,
      },
    ),
  ).rejects.toThrow("different upstream identity");
});

test("source acquisition waits for the same original to become independently verified", async () => {
  if (cloudflareSource === undefined) throw new Error("source entry missing");
  let calls = 0;
  let waits = 0;
  const requests: AcquireUpstreamArtifact[] = [];
  const selected = await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "no set");
      },
      findQualifiedArtifact: async () => {
        throw new DeliveryClientError(404, "NOT_FOUND", "no source");
      },
      acquireUpstreamArtifact: async (request) => {
        requests.push(request);
        calls += 1;
        return {
          ...verified(request),
          status: calls === 1 ? "pending" : "verified",
        };
      },
    },
    catalog(cloudflareSource),
    producer,
    {
      credentials: unexpected,
      registry: "v2",
      sourceTransport: async (url) =>
        new Response(
          url.startsWith("https://api.github.com/") ? sourceCommit : "source",
        ),
      publishArchive: async (input) => {
        expect(input.uri).toContain("delivery-artifacts");
      },
      waitForPending: async () => {
        waits += 1;
      },
    },
  );
  expect(waits).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(selected[0]?.version).toBe(sourceCommit);
});

function acquiredSourceVersion(originCommit: string) {
  const digest = `sha256:${"7".repeat(64)}`;
  return ArtifactVersionSchema.parse({
    id: "upstream/cloudflare-operator/original",
    serviceId: "cloudflare-operator",
    component: "archive:cloudflare-operator",
    kind: "archive",
    buildId: "upstream/original-source-build",
    version: sourceCommit,
    sourceRevision: "a".repeat(40),
    createdAt: "2026-10-17T10:00:00.000Z",
    uri: sourceArchiveUri("adyanth/cloudflare-operator", digest),
    digest,
    origin: {
      kind: "upstream",
      repository: "https://github.com/adyanth/cloudflare-operator",
      name: "adyanth/cloudflare-operator",
      version: cloudflareSource?.value,
      commit: originCommit,
      checksum: digest,
    },
  });
}

test("an acquired source is reused while its tag is pinned and acquired again when the tag moves", async () => {
  if (cloudflareSource === undefined)
    throw new Error("cloudflare-operator source entry missing");
  const archived = acquiredSourceVersion(sourceCommit);
  await expect(
    componentArtifactsForPublication(
      {
        latestQualifiedArtifact: async () => archived,
        acquireUpstreamArtifact: unexpected,
      },
      catalog(cloudflareSource),
      producer,
      {
        credentials: unexpected,
        mirror: unexpected,
        transport: unexpected,
        sourceTransport: unexpected,
        publishArchive: unexpected,
        githubToken: unexpected,
        registry: "v2",
      },
    ),
  ).resolves.toEqual([archived]);
  const reads: string[] = [];
  const stored: string[] = [];
  const requests: AcquireUpstreamArtifact[] = [];
  await componentArtifactsForPublication(
    {
      latestQualifiedArtifact: async () => archived,
      acquireUpstreamArtifact: async (input) => {
        requests.push(input);
        return verified(input);
      },
    },
    catalog({ ...cloudflareSource, value: "v0.14.0" }),
    producer,
    {
      credentials: unexpected,
      registry: "v2",
      sourceTransport: async (url) => {
        reads.push(url);
        return new Response(
          url.startsWith("https://api.github.com/")
            ? "9".repeat(40)
            : "newer tarball",
        );
      },
      publishArchive: async (input) => {
        stored.push(input.uri);
      },
    },
  );
  expect(reads[0]).toBe(
    "https://api.github.com/repos/adyanth/cloudflare-operator/commits/v0.14.0",
  );
  expect(requests.map((request) => request.artifact.origin)).toEqual([
    expect.objectContaining({ version: "v0.14.0", commit: "9".repeat(40) }),
  ]);
  expect(stored).toEqual(requests.map((request) => request.artifact.uri));
  // The contract binds a source artifact to the commit it stored.
  expect(() => acquiredSourceVersion("8".repeat(40))).toThrow("source commit");
});

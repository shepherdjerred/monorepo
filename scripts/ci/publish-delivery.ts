#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { z } from "zod";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  PublishBuildSchema,
  ArtifactInputSchema,
} from "@shepherdjerred/delivery/contract";
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog, Service } from "@shepherdjerred/ops-model/catalog.ts";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import {
  readOptionalHandoff,
  readRequiredHandoff,
} from "../lib/ci/ci-handoff.ts";
import { requireEnv, run } from "../lib/run.ts";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/u);
const DigestsSchema = z.record(
  z.string().regex(/^shepherdjerred\/[\w-]+(?:\/[\w-]+)*$/u),
  DigestSchema,
);
const ChartInventorySchema = z.array(
  z.object({
    name: z.string().regex(/^[\w-]+$/u),
    revision: z.string().min(1),
    prune: z.boolean().optional(),
  }),
);
const IndexSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.enum([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ]),
  manifests: z
    .array(
      z.object({
        digest: DigestSchema,
        platform: z
          .object({ architecture: z.string(), os: z.string() })
          .optional(),
      }),
    )
    .min(1),
});
const ImageManifestSchema = z.object({
  schemaVersion: z.literal(2),
  mediaType: z.enum([
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ]),
  config: z.object({ digest: DigestSchema }),
  layers: z.array(z.object({ digest: DigestSchema })),
});

type Artifact = z.output<typeof PublishBuildSchema>["artifacts"][number];
type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type PublicationInput = {
  digests: unknown;
  charts: unknown;
  siteArtifacts?: unknown;
  sourceRevision: string;
  ciUrl: string;
  pipelineNumber: number;
  repositoryId: number;
  capturedAt: string;
  catalog?: Catalog;
};
type PublicationDependencies = {
  inspectImage: (reference: string) => Promise<string>;
  chartArtifact: (
    name: string,
    version: string,
  ) => Promise<Pick<Artifact, "uri" | "digest">>;
};

function imageService(name: string, catalog: Catalog): Service {
  const owner = new ServiceIndex(catalog).byImage(name);
  if (owner === undefined)
    throw new Error(
      `Image shepherdjerred/${name} requires a service catalog owner`,
    );
  return owner;
}

/** Verify raw registry bytes before accepting platform manifest digests. */
export function imageRuntimeDigests(
  raw: string,
  expectedDigest: string,
): string[] {
  const matches = (source: string) =>
    `sha256:${createHash("sha256").update(source).digest("hex")}` ===
    expectedDigest;
  if (!matches(raw) && !(raw.endsWith("\n") && matches(raw.slice(0, -1))))
    throw new Error(
      "Registry manifest bytes do not match the published digest",
    );
  const manifest: unknown = JSON.parse(raw);
  const index = IndexSchema.safeParse(manifest);
  if (index.success)
    return [
      ...new Set(
        index.data.manifests
          .filter(
            (entry) =>
              entry.platform?.architecture !== "unknown" &&
              entry.platform?.os !== "unknown",
          )
          .map((entry) => entry.digest),
      ),
    ];
  ImageManifestSchema.parse(manifest);
  return [];
}

export async function downloadChartArtifact(
  name: string,
  version: string,
  options: { origin: string; fetch?: Fetch },
) {
  const transport = options.fetch ?? fetch;
  const response = await transport(
    new URL(
      `/api/charts/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      options.origin,
    ),
    { signal: AbortSignal.timeout(30_000), redirect: "error" },
  );
  if (!response.ok)
    throw new Error(
      `Chart metadata unavailable for ${name}@${version} (${String(response.status)})`,
    );
  const raw: unknown = await response.json();
  const metadata = z
    .object({
      name: z.literal(name),
      version: z.literal(version),
      digest: z.string().regex(/^[a-f\d]{64}$/u),
      urls: z.array(z.string()).min(1),
    })
    .parse(raw);
  const uri = new URL(`/charts/${name}-${version}.tgz`, options.origin);
  if (
    !metadata.urls.some(
      (entry) => new URL(entry, `${options.origin}/`).href === uri.href,
    )
  )
    throw new Error(
      `Chart archive URL differs from the selected immutable version: ${name}@${version}`,
    );
  const archive = await transport(uri, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!archive.ok)
    throw new Error(
      `Chart archive unavailable for ${name}@${version} (${String(archive.status)})`,
    );
  const digest = createHash("sha256")
    .update(new Uint8Array(await archive.arrayBuffer()))
    .digest("hex");
  if (digest !== metadata.digest)
    throw new Error(`Chart archive checksum mismatch for ${name}@${version}`);
  return { uri: uri.href, digest: `sha256:${digest}` };
}

export async function buildPublications(
  input: PublicationInput,
  dependencies: PublicationDependencies,
): Promise<PublishBuild[]> {
  const catalog = input.catalog ?? SERVICE_CATALOG;
  const publications = new Map<string, Artifact[]>();
  function add(serviceId: string, artifact: Artifact) {
    const entries = publications.get(serviceId) ?? [];
    if (entries.some((entry) => entry.component === artifact.component)) {
      const existing = entries.find(
        (entry) => entry.component === artifact.component,
      );
      if (existing?.digest !== artifact.digest)
        throw new Error(
          `One CI pipeline published conflicting versions of ${artifact.component}`,
        );
      return;
    }
    entries.push(artifact);
    publications.set(serviceId, entries);
  }
  for (const [key, digest] of Object.entries(
    DigestsSchema.parse(input.digests),
  )) {
    const name = key.split("/")[1];
    if (name === undefined)
      throw new Error(`Image pin key is malformed: ${key}`);
    const service = imageService(name, catalog);
    const uri = firstPartyImageRepository(name);
    const raw = await dependencies.inspectImage(`${uri}@${digest}`);
    add(service.id, {
      id: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/image/${name}`,
      component: `image:${name}`,
      kind: "image",
      uri,
      digest,
      runtimeDigests: imageRuntimeDigests(raw, digest),
      requires: {},
      version: `build-${String(input.pipelineNumber)}`,
    });
  }
  const charts =
    input.charts === undefined ? [] : ChartInventorySchema.parse(input.charts);
  for (const chart of charts) {
    const owner = new ServiceIndex(catalog).byChart(chart.name);
    if (owner === undefined)
      throw new Error(`Chart ${chart.name} requires a service catalog owner`);
    const artifact = await dependencies.chartArtifact(
      chart.name,
      chart.revision,
    );
    add(owner.id, {
      id: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/chart/${chart.name}`,
      component: `chart:${chart.name}`,
      kind: "chart",
      version: chart.revision,
      runtimeDigests: [],
      requires: {},
      ...artifact,
    });
  }
  const sites = z
    .array(
      z
        .object({ serviceId: z.string().min(1), artifact: ArtifactInputSchema })
        .strict(),
    )
    .parse(input.siteArtifacts ?? []);
  for (const site of sites) {
    if (!catalog.services.some((service) => service.id === site.serviceId))
      throw new Error(
        `Static artifact references an unknown service ${site.serviceId}`,
      );
    if (site.artifact.kind !== "archive")
      throw new Error(
        "Static publication requires an immutable archive artifact",
      );
    add(site.serviceId, site.artifact);
  }
  return [...publications].map(([serviceId, artifacts]) =>
    PublishBuildSchema.parse({
      requestId: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/${serviceId}`,
      serviceId,
      sourceRevision: input.sourceRevision,
      ciUrl: input.ciUrl,
      verifiedAt: input.capturedAt,
      artifacts,
    }),
  );
}

async function main() {
  const rawDigests: unknown = JSON.parse(
    await readRequiredHandoff("image-digests"),
  );
  const rawCharts = await readOptionalHandoff("argocd-release-expected");
  const charts: unknown =
    rawCharts === undefined ? undefined : JSON.parse(rawCharts);
  const siteArtifacts: unknown = JSON.parse(
    await readRequiredHandoff("site-artifacts"),
  );
  const publications = await buildPublications(
    {
      digests: rawDigests,
      charts,
      siteArtifacts,
      sourceRevision: requireEnv("CI_COMMIT_SHA"),
      ciUrl: requireEnv("CI_PIPELINE_URL"),
      pipelineNumber: z.coerce
        .number()
        .int()
        .positive()
        .parse(requireEnv("CI_PIPELINE_NUMBER")),
      repositoryId: z.coerce
        .number()
        .int()
        .positive()
        .parse(requireEnv("CI_REPO_ID")),
      capturedAt: new Date().toISOString(),
    },
    {
      inspectImage: async (reference) => {
        const result = await run(
          ["docker", "buildx", "imagetools", "inspect", "--raw", reference],
          {
            capture: true,
            echoCapturedStdout: false,
            unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
          },
        );
        return result.stdout;
      },
      chartArtifact: (name, version) =>
        downloadChartArtifact(name, version, {
          origin: "https://chartmuseum.tailnet-1a49.ts.net",
        }),
    },
  );
  const client = createDeliveryClient({
    baseUrl: requireEnv("DELIVERY_URL"),
    headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
  });
  for (const publication of publications) {
    const result = await client.publish(publication);
    console.log(
      `Registered pending Delivery build ${result.buildId} for ${publication.serviceId}`,
    );
  }
}

if (import.meta.main) await main();

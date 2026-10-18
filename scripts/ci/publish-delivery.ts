#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  PublishBuildSchema,
  ArtifactInputSchema,
  ArtifactVersionSchema,
} from "@shepherdjerred/delivery/contract";
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog, Service } from "@shepherdjerred/ops-model/catalog.ts";
import { ChartPublicationSchema } from "@shepherdjerred/ops-model/chart-publication.ts";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import {
  readPublicationHandoffs,
  SitePublicationSchema,
  ChartInventorySchema,
} from "../lib/ci/delivery-publication-handoffs.ts";
import { requireEnv, run } from "../lib/run.ts";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import {
  parseVersionCatalog,
  versionCatalogMap,
} from "@shepherdjerred/version-catalog";
import { minecraftChartForPublication } from "../lib/ci/delivery-upstream-artifacts.ts";
import { attachForumPublication } from "../lib/ci/delivery-forum-publication.ts";
import { imageRuntimeDigests } from "../lib/ci/image-runtime-digests.ts";
import {
  attachPlatformPublication,
  platformSourceFiles,
} from "../lib/ci/delivery-platform-publication.ts";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/u);
const DigestsSchema = z.record(
  z.string().regex(/^shepherdjerred\/[\w-]+(?:\/[\w-]+)*$/u),
  DigestSchema,
);

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
  chartPublication?: unknown;
  retainedArtifacts?: unknown;
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

function retainedArtifactReferences(
  raw: unknown,
  publications: Map<string, Artifact[]>,
  catalog: Catalog,
) {
  const retained = new Map<string, z.output<typeof ArtifactVersionSchema>[]>();
  for (const artifact of z.array(ArtifactVersionSchema).parse(raw ?? [])) {
    if (!catalog.services.some((service) => service.id === artifact.serviceId))
      throw new Error("Retained artifact requires a canonical service owner");
    if (
      (publications.get(artifact.serviceId) ?? []).some(
        (entry) => entry.component === artifact.component,
      )
    )
      throw new Error(
        "A publication cannot replace and retain the same component",
      );
    const references = retained.get(artifact.serviceId) ?? [];
    if (
      references.some(
        (entry) =>
          entry.component === artifact.component && entry.id !== artifact.id,
      )
    )
      throw new Error(
        "A publication cannot retain conflicting artifacts for one component",
      );
    if (!references.some((entry) => entry.id === artifact.id))
      references.push(artifact);
    retained.set(artifact.serviceId, references);
    if (!publications.has(artifact.serviceId))
      publications.set(artifact.serviceId, []);
  }
  return retained;
}

function verifyChartProducer(input: PublicationInput) {
  if (input.chartPublication !== undefined) {
    const receipt = ChartPublicationSchema.parse(input.chartPublication);
    if (
      receipt.sourceRevision !== input.sourceRevision ||
      receipt.pipelineNumber !== input.pipelineNumber ||
      receipt.repositoryId !== input.repositoryId
    )
      throw new Error(
        "Fresh chart publication belongs to another source or CI execution",
      );
  }
}

export async function buildPublications(
  input: PublicationInput,
  dependencies: PublicationDependencies,
): Promise<PublishBuild[]> {
  const catalog = input.catalog ?? SERVICE_CATALOG;
  verifyChartProducer(input);
  const publications = new Map<string, Artifact[]>();
  function add(
    serviceId: string,
    rawArtifact: z.input<typeof ArtifactInputSchema>,
  ) {
    const artifact = ArtifactInputSchema.parse(rawArtifact);
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
      version: `2.0.0-${String(1_000_000 + input.pipelineNumber)}`,
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
    if (chart.digest !== undefined && chart.digest !== artifact.digest)
      throw new Error(
        "Published chart digest differs from its original producer receipt",
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
    .array(SitePublicationSchema.strict())
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
  const retained = retainedArtifactReferences(
    input.retainedArtifacts,
    publications,
    catalog,
  );
  return [...publications].map(([serviceId, artifacts]) =>
    PublishBuildSchema.parse({
      requestId: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/${serviceId}`,
      serviceId,
      sourceRevision: input.sourceRevision,
      ciUrl: input.ciUrl,
      verifiedAt: input.capturedAt,
      artifacts,
      retainedArtifactIds: (retained.get(serviceId) ?? []).map(
        (entry) => entry.id,
      ),
    }),
  );
}

export function parsePublicationOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { "static-archives": { type: "boolean", default: false } },
  });
  return { staticArchives: values["static-archives"] };
}

async function main() {
  const options = parsePublicationOptions(Bun.argv.slice(2));
  const sourceRevision = requireEnv("CI_COMMIT_SHA");
  const pipelineNumber = z.coerce
    .number()
    .int()
    .positive()
    .parse(requireEnv("CI_PIPELINE_NUMBER"));
  const repositoryId = z.coerce
    .number()
    .int()
    .positive()
    .parse(requireEnv("CI_REPO_ID"));
  const client = createDeliveryClient({
    baseUrl: requireEnv("DELIVERY_URL"),
    headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
  });
  const handoffs = await readPublicationHandoffs(options.staticArchives);
  const upstreamVersion = z
    .string()
    .parse(versionCatalogMap(parseVersionCatalog(rawCatalog))["minecraft"]);
  const acquired = await minecraftChartForPublication(
    client,
    upstreamVersion,
    { repositoryId, pipelineNumber, sourceRevision },
    {
      credentials: () => ({
        username: requireEnv("CHARTMUSEUM_USERNAME"),
        password: requireEnv("CHARTMUSEUM_PASSWORD"),
      }),
    },
  );
  const publications = await buildPublications(
    {
      ...handoffs,
      retainedArtifacts: [acquired],
      sourceRevision,
      ciUrl: requireEnv("CI_PIPELINE_URL"),
      pipelineNumber,
      repositoryId,
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
  const forumPublications = await attachForumPublication(
    publications,
    (query) => client.qualifiedForumBundle(query),
  );
  const platformPublications = await attachPlatformPublication(
    forumPublications,
    {
      sourceRevision,
      pipelineNumber,
      repositoryId,
      ciUrl: requireEnv("CI_PIPELINE_URL"),
      capturedAt: new Date().toISOString(),
      rootInventory: handoffs.rootInventory,
      files: await platformSourceFiles(
        sourceRevision,
        Bun.env["CI_CHANGED_BASE"],
      ),
    },
    async () => {
      const artifact = await client.latestQualifiedArtifact({
        serviceId: "gitops",
        component: "chart:apps",
        kind: "chart",
      });
      return artifact.id;
    },
    options.staticArchives
      ? (bucket) =>
          client.latestQualifiedArtifact({
            serviceId: "static-sites",
            component: `site:${bucket}`,
            kind: "archive",
          })
      : undefined,
  );
  for (const publication of platformPublications) {
    const result = await client.publish(publication);
    console.log(
      `Registered pending Delivery build ${result.buildId} for ${publication.serviceId}`,
    );
  }
}

if (import.meta.main) await main();

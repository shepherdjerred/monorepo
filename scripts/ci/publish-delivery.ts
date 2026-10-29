#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { z } from "zod";
import {
  createDeliveryClient,
  DeliveryClientError,
} from "@shepherdjerred/delivery/client";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import type {
  ArtifactVersion,
  FindQualifiedArtifact,
  PublishBuild,
  PublishBuildSchema,
} from "@shepherdjerred/delivery/contract";
import {
  publicationOwners,
  type PublicationOwners,
} from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import {
  ChartPublicationSchema,
  PublishedChartReceiptSchema,
  RetainedChartReceiptSchema,
} from "@shepherdjerred/ops-model/chart-publication.ts";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import {
  readPublicationHandoffs,
  SitePublicationSchema,
} from "../lib/ci/delivery-publication-handoffs.ts";
import { requireEnv, run } from "../lib/run.ts";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import {
  componentArtifactsForPublication,
  v1AcquisitionCatalog,
} from "../lib/ci/delivery-upstream-artifacts.ts";
import { attachForumPublication } from "../lib/ci/delivery-forum-publication.ts";
import { imageRuntimeDigests } from "../lib/ci/image-runtime-digests.ts";
import {
  attachPlatformPublication,
  platformSourceFiles,
} from "../lib/ci/delivery-platform-publication.ts";
import { PublicationLedger } from "../lib/ci/delivery-publication-ledger.ts";
import {
  attachTofuArchivePublications,
  TOFU_ARCHIVE_HANDOFF,
} from "../lib/ci/delivery-tofu-publication.ts";
import { readRequiredHandoff } from "../lib/ci/ci-handoff.ts";
import {
  NPM_PACKAGE_HANDOFF,
  parseNpmPackagePublications,
} from "../lib/artifacts/npm-package-archive.ts";

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
  retainedCharts?: unknown;
  siteArtifacts?: unknown;
  /** The npm channel packages' frozen tarballs; v2 catalog only. */
  packageArtifacts?: unknown;
  sourceRevision: string;
  ciUrl: string;
  pipelineNumber: number;
  repositoryId: number;
  capturedAt: string;
  /** The registry that names each build's owner; v1 until the window's catalog flip. */
  owners?: PublicationOwners;
  chartPublication?: unknown;
  retainedArtifacts?: unknown;
};
type PublicationDependencies = {
  inspectImage: (reference: string) => Promise<string>;
  chartArtifact: (
    name: string,
    version: string,
  ) => Promise<Pick<Artifact, "uri" | "digest">>;
  /** The qualified artifact with these exact bytes, or undefined when none exists (404). */
  findQualifiedArchive?: (
    query: FindQualifiedArtifact,
  ) => Promise<ArtifactVersion | undefined>;
};

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

/** A retained archive must be the qualified artifact the lookup asked for, never a near match. */
function verifyQualifiedArchive(
  query: FindQualifiedArtifact,
  original: ArtifactVersion,
) {
  if (
    original.serviceId !== query.serviceId ||
    original.component !== query.component ||
    original.kind !== "archive" ||
    original.digest !== query.digest ||
    original.origin.kind !== "first-party"
  )
    throw new Error(
      `Qualified archive differs from its lookup for ${query.component}`,
    );
}

async function addImagePublications(
  ledger: PublicationLedger,
  input: PublicationInput,
  owners: PublicationOwners,
  dependencies: PublicationDependencies,
) {
  for (const [key, digest] of Object.entries(
    DigestsSchema.parse(input.digests),
  )) {
    const name = key.split("/")[1];
    if (name === undefined)
      throw new Error(`Image pin key is malformed: ${key}`);
    const owner = owners.image(name);
    // A retired service's image is still built for its live Application but
    // never registered: Delivery admits no builds of a retired service.
    if (!owners.admits(owner)) continue;
    const uri = firstPartyImageRepository(name);
    const raw = await dependencies.inspectImage(`${uri}@${digest}`);
    ledger.add(owner, {
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
}

async function addChartPublications(
  ledger: PublicationLedger,
  input: PublicationInput,
  owners: PublicationOwners,
  dependencies: PublicationDependencies,
) {
  const charts =
    input.charts === undefined
      ? []
      : z.array(PublishedChartReceiptSchema).parse(input.charts);
  for (const chart of charts) {
    const owner = owners.chart(chart.name);
    if (owner === undefined) continue;
    const artifact = await dependencies.chartArtifact(
      chart.name,
      chart.revision,
    );
    if (chart.digest !== artifact.digest)
      throw new Error(
        "Published chart digest differs from its original producer receipt",
      );
    ledger.add(owner, {
      id: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/chart/${chart.name}`,
      component: `chart:${chart.name}`,
      kind: "chart",
      version: chart.revision,
      runtimeDigests: [],
      requires: {},
      contentFingerprint: chart.contentFingerprint,
      ...artifact,
    });
  }
  // Unchanged charts reference the qualified artifact the producer planned against.
  for (const chart of z
    .array(RetainedChartReceiptSchema)
    .parse(input.retainedCharts ?? [])) {
    const owner = owners.chart(chart.name);
    if (owner === undefined) continue;
    ledger.retain(owner, {
      id: chart.artifactId,
      component: `chart:${chart.name}`,
    });
  }
}

/**
 * Bytes that already exist as a qualified archive with the same dependencies
 * are retained by reference and never registered again (B2): a site
 * archive, or an npm channel package's tarball.
 */
async function addArchivePublication(
  ledger: PublicationLedger,
  site: z.output<typeof SitePublicationSchema>,
  owners: PublicationOwners,
  dependencies: PublicationDependencies,
) {
  if (!owners.owns(site.serviceId))
    throw new Error(
      `Archive artifact references an unknown service ${site.serviceId}`,
    );
  if (site.artifact.kind !== "archive")
    throw new Error(
      "Archive publication requires an immutable archive artifact",
    );
  if (site.artifact.origin.kind !== "first-party")
    throw new Error(
      "Archive publication requires a first-party archive artifact",
    );
  const query: FindQualifiedArtifact = {
    serviceId: site.serviceId,
    component: site.artifact.component,
    kind: "archive",
    digest: site.artifact.digest,
    originKind: "first-party",
  };
  const original = await dependencies.findQualifiedArchive?.(query);
  if (original !== undefined) {
    verifyQualifiedArchive(query, original);
    if (isDeepStrictEqual(original.requires, site.artifact.requires)) {
      ledger.retain(site.serviceId, {
        id: original.id,
        component: original.component,
      });
      return;
    }
  }
  ledger.add(site.serviceId, site.artifact);
}

export async function buildPublications(
  input: PublicationInput,
  dependencies: PublicationDependencies,
): Promise<PublishBuild[]> {
  const owners = input.owners ?? publicationOwners("v1");
  verifyChartProducer(input);
  const ledger = new PublicationLedger((serviceId) => owners.owns(serviceId));
  await addImagePublications(ledger, input, owners, dependencies);
  await addChartPublications(ledger, input, owners, dependencies);
  for (const site of z
    .array(SitePublicationSchema.strict())
    .parse(input.siteArtifacts ?? []))
    await addArchivePublication(ledger, site, owners, dependencies);
  // npm channel tarballs, under the v2 catalog only (X12).
  for (const pkg of input.packageArtifacts === undefined
    ? []
    : parseNpmPackagePublications(input.packageArtifacts, input))
    await addArchivePublication(ledger, pkg, owners, dependencies);
  for (const artifact of z
    .array(ArtifactVersionSchema)
    .parse(input.retainedArtifacts ?? []))
    ledger.retain(artifact.serviceId, {
      id: artifact.id,
      component: artifact.component,
    });
  return ledger.builds(input);
}

export function parsePublicationOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      "static-archives": { type: "boolean", default: false },
      "catalog-v2": { type: "boolean", default: false },
    },
  });
  return {
    staticArchives: values["static-archives"],
    catalogV2: values["catalog-v2"],
  };
}

async function packageArchiveHandoff(): Promise<unknown> {
  const raw: unknown = JSON.parse(
    await readRequiredHandoff(NPM_PACKAGE_HANDOFF),
  );
  return raw;
}

async function tofuArchiveHandoff(): Promise<unknown> {
  const raw: unknown = JSON.parse(
    await readRequiredHandoff(TOFU_ARCHIVE_HANDOFF),
  );
  return raw;
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
  const owners = publicationOwners(options.catalogV2 ? "v2" : "v1");
  const handoffs = await readPublicationHandoffs(options.staticArchives);
  const versionCatalog = parseVersionCatalog(rawCatalog);
  const components = await componentArtifactsForPublication(
    client,
    options.catalogV2 ? versionCatalog : v1AcquisitionCatalog(versionCatalog),
    { repositoryId, pipelineNumber, sourceRevision },
    {
      registry: owners.registry,
      credentials: () => ({
        username: requireEnv("CHARTMUSEUM_USERNAME"),
        password: requireEnv("CHARTMUSEUM_PASSWORD"),
      }),
      githubToken: () => requireEnv("GITHUB_DOWNLOAD_TOKEN"),
    },
  );
  const publications = await buildPublications(
    {
      ...handoffs,
      ...(options.catalogV2
        ? { packageArtifacts: await packageArchiveHandoff() }
        : {}),
      owners,
      retainedArtifacts: [...handoffs.retainedArtifacts, ...components],
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
      findQualifiedArchive: async (query) => {
        try {
          return await client.findQualifiedArtifact(query);
        } catch (error) {
          if (error instanceof DeliveryClientError && error.status === 404)
            return;
          throw error;
        }
      },
    },
  );
  const forumPublications = await attachForumPublication(
    publications,
    (query) => client.qualifiedForumBundle(query),
  );
  const identity = {
    sourceRevision,
    pipelineNumber,
    repositoryId,
    ciUrl: requireEnv("CI_PIPELINE_URL"),
    capturedAt: new Date().toISOString(),
  };
  // v2 registers every OpenTofu stack's frozen archive under its tofu-<stack>
  // service. v1 releases the root and its stacks through the platform
  // publication, as before the window's catalog flip.
  const registered = options.catalogV2
    ? attachTofuArchivePublications(
        forumPublications,
        await tofuArchiveHandoff(),
        identity,
      )
    : await attachPlatformPublication(
        forumPublications,
        {
          ...identity,
          rootInventory: handoffs.rootInventory,
          retainedCharts: handoffs.retainedCharts,
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
  for (const publication of registered) {
    const result = await client.publish(publication);
    console.log(
      `Registered pending Delivery build ${result.buildId} for ${publication.serviceId}`,
    );
  }
}

if (import.meta.main) await main();

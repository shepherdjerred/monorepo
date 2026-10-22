import { createHash } from "node:crypto";
import { composeVerifiedBuild } from "#infrastructure/composition/verified-build.ts";
import { z } from "zod";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json" with { type: "json" };
import {
  catalogComponentName,
  componentEntries,
  parseVersionCatalog,
  upstreamName,
} from "@shepherdjerred/version-catalog";
import type { VersionCatalogEntry } from "@shepherdjerred/version-catalog";
import { CatalogComponentSchema } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import {
  AcquireUpstreamArtifactSchema,
  ArtifactAcquisitionSchema,
  FindQualifiedArtifactSchema,
} from "#shared/contract.ts";
import type {
  AcquireUpstreamArtifact,
  FindQualifiedArtifact,
  Principal,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "./auth.ts";
import type { Delivery } from "./delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  remember,
  request,
  required,
  wire,
} from "./delivery-records.ts";
import {
  id,
  artifactRow,
  artifactView,
  ensureService,
  qualifiedBuildWhere,
} from "./delivery-data.ts";
import {
  boundedBody,
  registryLocation,
  resolveManifestDigest,
} from "./artifact-stores/oci-registry.ts";
import type { RegistryLocation } from "./artifact-stores/oci-registry.ts";

export type UpstreamFetch = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;
/** Reviewed acquisition targets: the committed version catalog's component entries. */
export const catalogComponents: readonly VersionCatalogEntry[] =
  componentEntries(parseVersionCatalog(rawCatalog));
const MAX_BYTES = 16 * 1024 * 1024;
/** Transitional (X11): the Minecraft chart stays mirrored until its pipeline is re-registered. */
const CHART_MIRRORS = [
  "https://chartmuseum.sjer.red",
  "https://chartmuseum.tailnet-1a49.ts.net",
];
const GITHUB_ASSET_HOSTS = [
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
];
const ChartIndexEntrySchema = z.object({
  name: z.string(),
  version: z.string(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  urls: z.tuple([z.string()], z.string()),
});
const ChartIndexSchema = z.object({
  entries: z.record(z.string(), z.unknown()),
});

type Input = z.output<typeof AcquireUpstreamArtifactSchema>;
type Reviewed =
  | { kind: "chart"; originKey: string; name: string; repository: string }
  | {
      kind: "image";
      originKey: string;
      registry: RegistryLocation;
      tag: string;
    };

function registryUrl(entry: VersionCatalogEntry) {
  // Catalog validation guarantees this for component entries.
  if (!entry.management.managed || entry.management.registryUrl === undefined)
    throw new Error(`Catalog component ${entry.name} has no registry URL`);
  return entry.management.registryUrl;
}

function refuse(reason: string): never {
  throw new DeliveryError("INVALID", reason);
}

/**
 * The catalog document decides who acquires what: the requesting service
 * must declare the component with producer `acquisition` (section 4.5).
 */
function requireAcquiring(
  input: Input,
  service: { components: unknown } | null,
): void {
  const declared =
    service === null
      ? []
      : z.array(CatalogComponentSchema).parse(service.components);
  if (
    !declared.some(
      (component) =>
        component.name === input.artifact.component &&
        component.producer === "acquisition",
    )
  )
    refuse(
      `Service ${input.serviceId} does not acquire ${input.artifact.component} in the catalog document`,
    );
}

/**
 * The one version-catalog component entry the catalog document's component
 * name denotes: a chart by its name, an image by its repository basename.
 */
function catalogEntry(
  input: Input,
  components: readonly VersionCatalogEntry[],
): VersionCatalogEntry {
  const artifactType = input.artifact.kind === "chart" ? "helm-chart" : "image";
  const matches = components.filter(
    (candidate) =>
      candidate.artifactType === artifactType &&
      catalogComponentName(candidate) === input.artifact.component,
  );
  const [entry] = matches;
  if (entry === undefined || matches.length !== 1)
    refuse(
      "Independent acquisition is restricted to exactly one version catalog component entry",
    );
  return entry;
}

/** Map the intent onto exactly one catalog component entry; nothing is read before this passes. */
function reviewed(
  input: Input,
  components: readonly VersionCatalogEntry[],
): Reviewed {
  const { artifact } = input;
  const origin = artifact.origin;
  if (origin.kind !== "upstream")
    refuse("Upstream acquisition requires explicit original origin");
  if (artifact.kind !== "chart" && artifact.kind !== "image")
    refuse("Upstream acquisition covers charts and images only");
  const entry = catalogEntry(input, components);
  // Each acquiring service owns its own artifact of an origin: the catalog
  // document may name several (section 4.5), and concurrent acquisitions by
  // one service converge on one row.
  const originKey = fingerprint({
    serviceId: input.serviceId,
    kind: origin.kind,
    repository: origin.repository,
    name: origin.name,
    version: origin.version,
  });
  if (artifact.kind === "chart") {
    const repository = `${registryUrl(entry).replace(/\/+$/, "")}/`;
    if (origin.repository !== repository || origin.name !== entry.name)
      refuse(
        "Chart acquisition must match the catalog component's repository and name",
      );
    if (new URL(artifact.uri).protocol !== "https:")
      refuse("Chart archive location must be an https URL");
    return { kind: "chart", originKey, name: entry.name, repository };
  }
  // An alias entry is pulled from, and verified at, its real repository.
  const name = upstreamName(entry);
  const registry = registryLocation(registryUrl(entry), name);
  if (
    origin.repository !== registryUrl(entry) ||
    origin.name !== name ||
    artifact.uri !== registry.uri
  )
    refuse(
      "Image acquisition must match the catalog component's registry, repository and image URI",
    );
  return { kind: "image", originKey, registry, tag: origin.version };
}

async function boundedRead(
  url: string,
  transport: UpstreamFetch,
  redirectHosts: ReadonlySet<string>,
  redirects = 0,
): Promise<Uint8Array> {
  const response = await transport(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const next = new URL(
      required(response.headers.get("location"), "Upstream archive redirect"),
      url,
    );
    if (
      redirects >= 3 ||
      !redirectHosts.has(next.hostname) ||
      next.protocol !== "https:" ||
      next.username !== "" ||
      next.password !== ""
    )
      refuse("Upstream archive redirected outside reviewed release hosts");
    return boundedRead(next.href, transport, redirectHosts, redirects + 1);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DeliveryError(
      "PAUSED",
      `Independent upstream byte verification unavailable (${String(response.status)})`,
    );
  }
  return boundedBody(response, MAX_BYTES, "Upstream index or archive");
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function verifyChart(
  input: Input,
  plan: Extract<Reviewed, { kind: "chart" }>,
  transport: UpstreamFetch,
) {
  const indexUrl = new URL("index.yaml", plan.repository);
  const redirectHosts = new Set([indexUrl.hostname, ...GITHUB_ASSET_HOSTS]);
  const index = ChartIndexSchema.safeParse(
    Bun.YAML.parse(
      new TextDecoder().decode(
        await boundedRead(indexUrl.href, transport, redirectHosts),
      ),
    ),
  );
  const versions = z
    .array(ChartIndexEntrySchema)
    .safeParse(index.success ? index.data.entries[plan.name] : undefined);
  if (!versions.success)
    refuse(
      "Upstream index is not a readable Helm repository index for the pinned chart",
    );
  const selected = versions.data.filter(
    (entry) =>
      entry.name === plan.name && entry.version === input.artifact.version,
  );
  const entry = selected[0];
  if (entry === undefined || selected.length !== 1)
    refuse("Upstream index must attest the pinned chart version exactly once");
  const archive = new URL(entry.urls[0], plan.repository);
  if (archive.protocol !== "https:")
    refuse("Upstream index names a non-https chart archive");
  if (`sha256:${entry.digest}` !== input.artifact.digest)
    refuse("Upstream index checksum differs from the acquisition digest");
  const locations = new Set([
    archive.href,
    ...CHART_MIRRORS.map(
      (mirror) => `${mirror}/charts/${plan.name}-${input.artifact.version}.tgz`,
    ),
  ]);
  if (!locations.has(input.artifact.uri))
    refuse(
      "Chart artifact location must be the upstream archive or its reviewed ChartMuseum mirror",
    );
  redirectHosts.add(archive.hostname);
  for (const location of new Set([archive.href, input.artifact.uri]))
    if (
      sha256(await boundedRead(location, transport, redirectHosts)) !==
      input.artifact.digest
    )
      refuse(
        "Upstream or mirrored archive bytes differ from the attested checksum",
      );
}

async function verifyImage(
  input: Input,
  plan: Extract<Reviewed, { kind: "image" }>,
  transport: UpstreamFetch,
) {
  const digest = await resolveManifestDigest(
    plan.registry,
    plan.tag,
    transport,
  );
  if (digest !== input.artifact.digest)
    refuse(
      "Registry manifest for the requested tag differs from the requested digest",
    );
}

export async function findQualifiedArtifact(
  this: Delivery,
  rawInput: FindQualifiedArtifact,
  repositoryId: number,
) {
  const input = FindQualifiedArtifactSchema.parse(rawInput);
  const row = required(
    await this.database.artifact.findFirst({
      where: {
        component: input.component,
        kind: input.kind,
        digest: input.digest,
        ...(input.version === undefined ? {} : { version: input.version }),
        origin: { path: ["kind"], equals: input.originKind },
        build: qualifiedBuildWhere(input.serviceId, repositoryId),
      },
      include: { build: true },
      orderBy: { createdAt: "asc" },
    }),
    "Exact original qualified artifact",
  );
  return artifactView(row);
}

export type AcquisitionOptions = {
  transport?: UpstreamFetch;
  /** Reviewed component entries; production uses the committed catalog. */
  components?: readonly VersionCatalogEntry[];
};

export async function acquireUpstreamArtifact(
  this: Delivery,
  rawInput: AcquireUpstreamArtifact,
  actor: Principal,
  options: AcquisitionOptions = {},
) {
  requireScope(actor, "publish");
  const transport = options.transport ?? fetch;
  const input = AcquireUpstreamArtifactSchema.parse(rawInput);
  requireAcquiring(
    input,
    await this.database.service.findUnique({ where: { id: input.serviceId } }),
  );
  const plan = reviewed(input, options.components ?? catalogComponents);
  const { originKey } = plan;
  const buildId = await this.database.$transaction(async (tx) => {
    const prior = await request(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "upstream-build",
    });
    if (prior !== null) return prior.resultId;
    await ensureService(tx, input.serviceId);
    await lock(tx, `artifact-origin:${originKey}`);
    const original = await tx.artifact.findUnique({
      where: { originKey },
      include: { build: true },
    });
    let owner = original?.buildId;
    if (
      original !== null &&
      (original.build.serviceId !== input.serviceId ||
        original.component !== input.artifact.component ||
        original.digest !== input.artifact.digest ||
        original.uri !== input.artifact.uri ||
        fingerprint(original.origin) !== fingerprint(input.artifact.origin))
    )
      throw new DeliveryError(
        "CONFLICT",
        "Immutable upstream origin already identifies different bytes or provenance",
      );
    if (owner === undefined) {
      owner = id();
      await tx.build.create({
        data: {
          id: owner,
          requestId: input.requestId,
          serviceId: input.serviceId,
          sourceRevision: input.sourceRevision,
          sourceKind: "upstream",
          ...(input.pipeline === undefined
            ? {}
            : {
                repositoryId: input.pipeline.repositoryId,
                pipelineNumber: input.pipeline.pipelineNumber,
              }),
          verifiedAt: new Date(),
          artifacts: { create: { ...artifactRow(input.artifact), originKey } },
        },
      });
    }
    await remember(tx, actor, {
      requestId: input.requestId,
      input,
      resultType: "upstream-build",
      resultId: owner,
    });
    return owner;
  });
  const build = await this.database.build.findUniqueOrThrow({
    where: { id: buildId },
  });
  if (build.status !== "verified") {
    if (plan.kind === "chart") await verifyChart(input, plan, transport);
    else await verifyImage(input, plan, transport);
    await this.database.$transaction(async (tx) => {
      const changed = await tx.build.updateMany({
        where: { id: buildId, status: { in: ["pending", "failed"] } },
        data: {
          status: "verified",
          qualificationReason: null,
          verifiedAt: new Date(),
        },
      });
      if (changed.count > 0)
        await composeVerifiedBuild(
          tx,
          await tx.build.findUniqueOrThrow({ where: { id: buildId } }),
        );
      if (changed.count > 0)
        await audit(tx, actor, {
          action: "artifact.upstream_verified",
          entityId: buildId,
          requestId: input.requestId,
          metadata: {
            originKey,
            origin: input.artifact.origin,
            digest: input.artifact.digest,
          },
        });
    });
  }
  const original = await this.database.artifact.findUniqueOrThrow({
    where: { originKey },
    include: { build: true },
  });
  return ArtifactAcquisitionSchema.parse(
    wire({
      buildId,
      artifact: artifactView(original),
      status: original.build.status,
    }),
  );
}

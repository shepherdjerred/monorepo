import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type {
  AcquireUpstreamArtifact,
  ArtifactVersion,
} from "@shepherdjerred/delivery/contract";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import {
  CATALOG_CORE,
  type CatalogCore,
} from "@shepherdjerred/ops-model/delivery-catalog/core.ts";
import type { OwnerRegistry } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import {
  catalogComponentName,
  componentEntries,
  ociChart,
  upstreamName,
  type VersionCatalog,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import {
  acquireUpstreamChart,
  helmRepositoryUrl,
  type ChartTransport,
} from "./upstream-delivery-chart.ts";

/**
 * Charts still copied into ChartMuseum. Nothing new is mirrored (X11); the
 * registered minecraft-tsmc pipeline pulls chart:minecraft from
 * https://chartmuseum.sjer.red until WP3 re-registers it against the upstream
 * archive URL, so the Minecraft chart keeps its mirror until then.
 */
export const MIRRORED_CHARTS: ReadonlySet<string> = new Set(["minecraft"]);

export type UpstreamProducer = {
  repositoryId: number;
  pipelineNumber: number;
  sourceRevision: string;
};
export type ComponentArtifactOptions = {
  /**
   * v1 registers each component under its services.json owner; v2 under every
   * catalog service that acquires it. v1 until the window's catalog flip.
   */
  registry?: OwnerRegistry;
  /** The catalog document v2 reads acquiring services from. */
  core?: CatalogCore;
  credentials: () => { username: string; password: string };
  mirror?: typeof acquireUpstreamChart;
  transport?: ChartTransport;
  /** Delivery service owning each upstream image component; images have no catalog index. */
  imageOwners?: Record<string, string>;
};
type UpstreamIntent = {
  serviceId: string;
  component: string;
  kind: "chart" | "image";
  name: string;
  version: string;
  repository: string;
  /** Pinned bytes known before acquisition (images); charts learn theirs from the index. */
  digest?: string;
};
type UpstreamClient = Pick<
  DeliveryClient,
  "latestQualifiedArtifact" | "acquireUpstreamArtifact"
>;

/**
 * The version-catalog entries v1 acquires: only the Minecraft chart. Every
 * other `component: true` entry is acquired from the window's catalog flip
 * on; WP4 deletes this with the v1 path.
 */
const V1_ACQUIRED_ENTRIES: ReadonlySet<string> = new Set([
  "helm-chart:minecraft",
]);

/** The catalog as v1 acquires it: the other component entries stay unacquired. */
export function v1AcquisitionCatalog(catalog: VersionCatalog): VersionCatalog {
  return {
    ...catalog,
    entries: catalog.entries.map((entry) =>
      entry.component === true &&
      !V1_ACQUIRED_ENTRIES.has(`${entry.artifactType}:${entry.name}`)
        ? { ...entry, component: false }
        : entry,
    ),
  };
}

/** One intent per catalog service that acquires the entry's component. */
function catalogIntents(
  entry: VersionCatalogEntry,
  core: CatalogCore,
): UpstreamIntent[] {
  const component = catalogComponentName(entry);
  const owners = core.services.filter((service) =>
    service.components.some(
      (candidate) =>
        candidate.name === component && candidate.producer === "acquisition",
    ),
  );
  if (owners.length === 0)
    throw new Error(`Component ${component} has no acquiring catalog service`);
  const identity =
    entry.artifactType === "helm-chart"
      ? chartIdentity(entry)
      : imageIdentity(entry);
  return owners.map((owner) => ({
    ...identity,
    component,
    serviceId: owner.id,
  }));
}

function chartIdentity(
  entry: VersionCatalogEntry,
): Omit<UpstreamIntent, "serviceId"> {
  if (!entry.management.managed || entry.management.registryUrl === undefined)
    throw new Error(`Component chart ${entry.name} has no registryUrl`);
  // An OCI chart is pinned and verified by its manifest digest, like an
  // image, at `upstreamName` in its registry; it has no Helm index.
  if (ociChart(entry))
    return {
      ...registryIdentity(entry),
      component: `chart:${entry.name}`,
      kind: "chart",
    };
  return {
    component: `chart:${entry.name}`,
    kind: "chart",
    name: entry.name,
    version: entry.value,
    repository: helmRepositoryUrl(entry.management.registryUrl),
  };
}

/**
 * Where a registry-hosted entry (an image or an OCI chart) is pulled from and
 * verified at: `upstreamName` in its registry, pinned `tag@sha256:digest`. An
 * aliased entry (`itzg/minecraft-server-java8`) keeps its catalog name as its
 * component.
 */
function registryIdentity(
  entry: VersionCatalogEntry,
): Omit<UpstreamIntent, "serviceId" | "component" | "kind"> {
  if (!entry.management.managed || entry.management.registryUrl === undefined)
    throw new Error(`Component ${entry.name} has no registryUrl`);
  const pinned = /^([^@\s]+)@(sha256:[a-f0-9]{64})$/u.exec(entry.value);
  if (pinned?.[1] === undefined || pinned[2] === undefined)
    throw new Error(`Component ${entry.name} must pin tag@sha256:digest`);
  return {
    name: upstreamName(entry),
    version: pinned[1],
    repository: entry.management.registryUrl,
    digest: pinned[2],
  };
}

function imageIdentity(
  entry: VersionCatalogEntry,
): Omit<UpstreamIntent, "serviceId"> {
  return {
    ...registryIdentity(entry),
    component: `image:${entry.name}`,
    kind: "image",
  };
}

function chartIntent(entry: VersionCatalogEntry): UpstreamIntent {
  const owner = new ServiceIndex(SERVICE_CATALOG).byChart(entry.name);
  if (owner === undefined)
    throw new Error(`Chart ${entry.name} requires a service catalog owner`);
  return { ...chartIdentity(entry), serviceId: owner.id };
}

function imageIntent(
  entry: VersionCatalogEntry,
  imageOwners: Record<string, string> | undefined,
): UpstreamIntent {
  const serviceId = imageOwners?.[entry.name];
  if (serviceId === undefined)
    throw new Error(
      `Upstream image ${entry.name} has no Delivery owner; declare it in imageOwners`,
    );
  return { ...imageIdentity(entry), serviceId };
}

function componentIntent(
  entry: VersionCatalogEntry,
  options: ComponentArtifactOptions,
): UpstreamIntent {
  switch (entry.artifactType) {
    case "helm-chart":
      return chartIntent(entry);
    case "image":
      return imageIntent(entry, options.imageOwners);
    case "package":
    case "source":
      throw new Error(
        `Component ${entry.name} is a ${entry.artifactType}, which Delivery cannot acquire`,
      );
  }
}

/** Reuse the original qualified pin; upstream availability is needed only for a new acquisition. */
async function retained(
  client: UpstreamClient,
  intent: UpstreamIntent,
): Promise<ArtifactVersion | undefined> {
  let original: ArtifactVersion;
  try {
    original = await client.latestQualifiedArtifact({
      serviceId: intent.serviceId,
      component: intent.component,
      kind: intent.kind,
    });
  } catch (error) {
    if (error instanceof DeliveryClientError && error.status === 404)
      return undefined;
    throw error;
  }
  if (
    original.version !== intent.version ||
    (intent.digest !== undefined && original.digest !== intent.digest)
  )
    return undefined;
  if (
    original.origin.kind !== "upstream" ||
    original.origin.repository !== intent.repository ||
    original.origin.name !== intent.name ||
    original.origin.version !== intent.version ||
    original.origin.checksum !== original.digest
  )
    throw new Error(
      `Qualified ${intent.component} must retain its reviewed original upstream identity`,
    );
  return original;
}

async function acquiredArtifact(
  intent: UpstreamIntent,
  options: ComponentArtifactOptions,
): Promise<AcquireUpstreamArtifact["artifact"]> {
  // A Helm-index chart learns its digest from the index; a registry-hosted
  // entry (an image or an OCI chart) is already pinned.
  if (intent.kind === "chart" && intent.digest === undefined) {
    const upstream = await (options.mirror ?? acquireUpstreamChart)(
      {
        name: intent.name,
        version: intent.version,
        repository: intent.repository,
      },
      {
        mirror: MIRRORED_CHARTS.has(intent.name),
        credentials: options.credentials,
        ...(options.transport === undefined
          ? {}
          : { transport: options.transport }),
      },
    );
    return {
      id: `upstream/${intent.name}/${intent.version}/${upstream.digest.slice(7)}`,
      component: intent.component,
      kind: "chart",
      uri: upstream.uri,
      digest: upstream.digest,
      version: intent.version,
      origin: upstream.origin,
    };
  }
  if (intent.digest === undefined)
    throw new Error(`Upstream image ${intent.name} has no pinned digest`);
  // The registry resolves the tag server-side; no bytes are needed here.
  // Helm pulls an OCI chart by the `oci://` scheme.
  const location = `${new URL(intent.repository).host}/${intent.name}`;
  return {
    id: `upstream/${intent.name}/${intent.version}/${intent.digest.slice(7)}`,
    component: intent.component,
    kind: intent.kind,
    uri: intent.kind === "chart" ? `oci://${location}` : location,
    digest: intent.digest,
    version: intent.version,
    origin: {
      kind: "upstream",
      repository: intent.repository,
      name: intent.name,
      version: intent.version,
      checksum: intent.digest,
    },
  };
}

/**
 * One qualified-or-acquired artifact per `component: true` catalog entry, in
 * catalog order. An acquisition runs inside this main pipeline and carries its
 * order key (B3/B4); a result that is not verified publishes nothing.
 */
export async function componentArtifactsForPublication(
  client: UpstreamClient,
  catalog: VersionCatalog,
  producer: UpstreamProducer,
  options: ComponentArtifactOptions,
): Promise<ArtifactVersion[]> {
  const v2 = options.registry === "v2";
  const artifacts: ArtifactVersion[] = [];
  for (const entry of componentEntries(catalog)) {
    // The bytes are acquired once per entry; v2 registers them under every
    // acquiring service, each with its own artifact and request identity.
    let acquired: AcquireUpstreamArtifact["artifact"] | undefined;
    for (const intent of v2
      ? catalogIntents(entry, options.core ?? CATALOG_CORE)
      : [componentIntent(entry, options)]) {
      const original = await retained(client, intent);
      if (original !== undefined) {
        artifacts.push(original);
        continue;
      }
      acquired ??= await acquiredArtifact(intent, options);
      artifacts.push(
        await registerAcquisition(client, producer, { intent, acquired, v2 }),
      );
    }
  }
  return artifacts;
}

async function registerAcquisition(
  client: UpstreamClient,
  producer: UpstreamProducer,
  {
    intent,
    acquired,
    v2,
  }: {
    intent: UpstreamIntent;
    acquired: AcquireUpstreamArtifact["artifact"];
    v2: boolean;
  },
): Promise<ArtifactVersion> {
  const pipeline = `ci/${String(producer.repositoryId)}/${String(producer.pipelineNumber)}`;
  const result = await client.acquireUpstreamArtifact({
    requestId: v2
      ? `${pipeline}/acquire/${intent.serviceId}/${intent.name}/${intent.version}`
      : `${pipeline}/acquire/${intent.name}/${intent.version}`,
    serviceId: intent.serviceId,
    sourceRevision: producer.sourceRevision,
    pipeline: {
      repositoryId: producer.repositoryId,
      pipelineNumber: producer.pipelineNumber,
    },
    artifact: v2
      ? {
          ...acquired,
          id: `upstream/${intent.serviceId}/${acquired.id.slice("upstream/".length)}`,
          component: intent.component,
        }
      : acquired,
  });
  if (result.status !== "verified")
    throw new Error(
      `Upstream ${intent.component} acquisition is ${result.status}; no eligible CI reference was published`,
    );
  return result.artifact;
}

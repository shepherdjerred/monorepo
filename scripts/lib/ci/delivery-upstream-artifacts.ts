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
  componentEntries,
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

function chartIntent(entry: VersionCatalogEntry): UpstreamIntent {
  const owner = new ServiceIndex(SERVICE_CATALOG).byChart(entry.name);
  if (owner === undefined)
    throw new Error(`Chart ${entry.name} requires a service catalog owner`);
  if (!entry.management.managed || entry.management.registryUrl === undefined)
    throw new Error(`Component chart ${entry.name} has no registryUrl`);
  return {
    serviceId: owner.id,
    component: `chart:${entry.name}`,
    kind: "chart",
    name: entry.name,
    version: entry.value,
    repository: helmRepositoryUrl(entry.management.registryUrl),
  };
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
  if (!entry.management.managed || entry.management.registryUrl === undefined)
    throw new Error(`Component image ${entry.name} has no registryUrl`);
  const pinned = /^([^@\s]+)@(sha256:[a-f0-9]{64})$/u.exec(entry.value);
  if (pinned?.[1] === undefined || pinned[2] === undefined)
    throw new Error(`Component image ${entry.name} must pin tag@sha256:digest`);
  return {
    serviceId,
    component: `image:${entry.name}`,
    kind: "image",
    name: entry.name,
    version: pinned[1],
    repository: entry.management.registryUrl,
    digest: pinned[2],
  };
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
  if (intent.kind === "chart") {
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
  return {
    id: `upstream/${intent.name}/${intent.version}/${intent.digest.slice(7)}`,
    component: intent.component,
    kind: "image",
    uri: `${new URL(intent.repository).host}/${intent.name}`,
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
  const artifacts: ArtifactVersion[] = [];
  for (const entry of componentEntries(catalog)) {
    const intent = componentIntent(entry, options);
    const original = await retained(client, intent);
    if (original !== undefined) {
      artifacts.push(original);
      continue;
    }
    const result = await client.acquireUpstreamArtifact({
      requestId: `ci/${String(producer.repositoryId)}/${String(producer.pipelineNumber)}/acquire/${intent.name}/${intent.version}`,
      serviceId: intent.serviceId,
      sourceRevision: producer.sourceRevision,
      pipeline: {
        repositoryId: producer.repositoryId,
        pipelineNumber: producer.pipelineNumber,
      },
      artifact: await acquiredArtifact(intent, options),
    });
    if (result.status !== "verified")
      throw new Error(
        `Upstream ${intent.component} acquisition is ${result.status}; no eligible CI reference was published`,
      );
    artifacts.push(result.artifact);
  }
  return artifacts;
}

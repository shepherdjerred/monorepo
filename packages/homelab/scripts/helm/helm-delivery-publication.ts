import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { ChartPublication } from "@shepherdjerred/ops-model/chart-publication.ts";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import {
  fingerprintChart,
  latestPublishedVersion,
  verifyArchiveDigest,
  type ChartInput,
  type PublishedChart,
  type HelmReleasePlan,
} from "./helm-release-core.ts";
import {
  imageRegistry,
  firstPartyImageRepository,
} from "@shepherdjerred/version-catalog/image-registry";
import { parseAllDocuments, stringify } from "yaml";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BUILD_REVISION_RE = /^2\.0\.0-[1-9]\d*$/u;
export const CHARTMUSEUM_ORIGIN = "https://chartmuseum.sjer.red";
export const CHARTMUSEUM_API = `${CHARTMUSEUM_ORIGIN}/api/charts`;

export type ChartMuseumRelease = NonNullable<
  ReturnType<typeof latestPublishedVersion>
>;

/** Required selection inputs used only by producer lint/render, outside the packaged chart. */
function selectionValidationValues(name: string) {
  // Producer-only inputs; never included in values.yaml or qualified selections.
  const digest = `sha256:${"f".repeat(64)}`;
  const image = (repository: string) =>
    `docker.io/shepherdjerred/${repository}@${digest}`;
  const owner = new ServiceIndex().byChart(name);
  const worker =
    name === "temporal" || name === "scout-beta" || name === "scout-prod";
  if (name === "delivery" || name === "arcade")
    return { delivery: { image: image(name) } };
  if (name === "delivery-control-plane")
    return {
      delivery: {
        images: { "delivery-control-plane": image("temporal-worker") },
      },
    };
  if (worker) {
    const central = name === "temporal";
    const repository = central ? "temporal-worker" : "scout-for-lol";
    const environmentId = central
      ? "temporal/prod"
      : `scout-for-lol/${name.slice(6)}`;
    return {
      delivery: {
        images: { [repository]: image(repository) },
        workerPool: JSON.stringify({
          schema: "delivery-worker-pool/v1",
          environmentId,
          target: central ? "central" : name,
          versions: [
            {
              environmentId,
              buildId: "f".repeat(40),
              host: {
                profile: central ? "central-workflows" : `${name}-workflows`,
              },
              image: image(repository),
              replicas: 1,
            },
          ],
        }),
      },
    };
  }
  if (
    name !== "storm-forum" &&
    name !== "storm-forum-beta" &&
    owner !== undefined &&
    owner.images.length > 0
  )
    return {
      delivery: {
        images: Object.fromEntries(
          owner.images.map((repository) => [repository, image(repository)]),
        ),
      },
    };
  if (name !== "storm-forum" && name !== "storm-forum-beta") return;
  return {
    delivery: {
      image: `docker.io/shepherdjerred/storm-forum@sha256:${"f".repeat(64)}`,
      bundleKey: `releases/${"f".repeat(64)}.zip`,
      bundleSha256: "f".repeat(64),
      releaseId: "f".repeat(32),
      previousBundleSha256: "e".repeat(64),
      previousXenforoVersion: "2.3.13",
      previousRuntimeImage: `docker.io/shepherdjerred/storm-forum@sha256:${"e".repeat(64)}`,
    },
  };
}

/** Synthetic producer validation only; no value here is packaged as a selection. */
export function chartValidationValues(name: string) {
  const selected = selectionValidationValues(name);
  if (selected === undefined && new ServiceIndex().byChart(name) === undefined)
    return;
  return {
    delivery: {
      ...selected?.delivery,
      dependencies: Object.fromEntries(
        imageRegistry.images.map((entry) => [
          entry.name,
          `${firstPartyImageRepository(entry.name)}@sha256:${"f".repeat(64)}`,
        ]),
      ),
    },
  };
}

/** Freeze root-owned first-party dependencies into immutable chart bytes. */
export function bindChartImageDependencies(
  manifest: string,
  images: Readonly<Record<string, string>>,
): string {
  function bind(value: unknown): unknown {
    if (typeof value === "string") {
      // Some upstream charts require repository:tag instead of a full image.
      // Freeze the same original digest into their tag@digest projection.
      const tagPrefix = '{{ printf "selected@%s" (last (splitList "@" (';
      const tagSuffix = "))) }}";
      const digestTag =
        value.startsWith(tagPrefix) && value.endsWith(tagSuffix);
      const reference = digestTag
        ? `{{ ${value.slice(tagPrefix.length, -tagSuffix.length)} }}`
        : value;
      const match =
        /^\{\{ required `Delivery requires image:([a-z0-9-]+)` \(get \(get \(\.Values\.delivery \| default dict\) "dependencies" \| default dict\) "\1"\) \}\}$/u.exec(
          reference,
        );
      const name = match?.[1];
      if (name === undefined) return value;
      const digest = images[`shepherdjerred/${name}`];
      if (digest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(digest))
        throw new Error(
          `Root chart dependency lacks its original published image:${name}`,
        );
      return digestTag
        ? `selected@${digest}`
        : `${firstPartyImageRepository(name)}@${digest}`;
    }
    if (Array.isArray(value)) return value.map((child) => bind(child));
    return value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, bind(child)]),
        )
      : value;
  }
  return parseAllDocuments(manifest)
    .map((doc) => {
      if (doc.errors.length > 0)
        throw new Error("Invalid generated chart manifest");
      return stringify(bind(doc.toJSON()), { compat: "yaml-1.1" });
    })
    .join("---\n");
}

export async function bindGeneratedDependencies(
  directory: string,
  images: Readonly<Record<string, string>> | undefined,
) {
  if (images === undefined) return;
  for await (const name of new Bun.Glob("*.k8s.yaml").scan(directory)) {
    const file = path.join(directory, name);
    await Bun.write(
      file,
      bindChartImageDependencies(await Bun.file(file).text(), images),
    );
  }
}

export type ChartPlanningClient = Pick<
  DeliveryClient,
  "latestRetainableArtifact"
>;

/** A published chart the planner compares against; Delivery bases name the artifact to retain. */
export type ChartPlanningBase = PublishedChart & {
  readonly digest: string;
  readonly artifactId?: string;
};

/** ChartMuseum's newest build-versioned release of a chart; no archive bytes are read. */
export async function fetchChartMuseumRelease(
  chartName: string,
): Promise<ChartMuseumRelease | undefined> {
  const response = await fetch(
    `${CHARTMUSEUM_API}/${encodeURIComponent(chartName)}`,
  );
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `ChartMuseum inventory failed for ${chartName}: HTTP ${response.status.toString()}`,
    );
  return latestPublishedVersion(await response.json());
}

/** ChartMuseum's newest release per chart: the version list behind staleness and retry checks. */
export async function chartMuseumInventory(
  inputs: readonly ChartInput[],
  dryRun: boolean,
): Promise<Map<string, ChartMuseumRelease>> {
  const inventory = new Map<string, ChartMuseumRelease>();
  if (dryRun) return inventory;
  const releases = await Promise.all(
    inputs.map(
      async (input) =>
        [input.name, await fetchChartMuseumRelease(input.name)] as const,
    ),
  );
  for (const [name, release] of releases)
    if (release !== undefined) inventory.set(name, release);
  return inventory;
}

async function extractArchive(archive: string, directory: string) {
  await mkdir(directory, { recursive: true });
  const child = Bun.spawn(["tar", "-xzf", archive, "-C", directory], {
    env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error(`Unable to extract chart archive ${archive}`);
}

/** Download, verify and fingerprint ChartMuseum's newest archive of a chart. */
export async function fetchPublishedArchive(
  chartName: string,
  release: ChartMuseumRelease,
  temporaryDirectory: string,
): Promise<ChartPlanningBase> {
  const response = await fetch(new URL(release.url, CHARTMUSEUM_ORIGIN));
  if (!response.ok)
    throw new Error(
      `ChartMuseum download failed for ${chartName}@${release.version}: HTTP ${response.status.toString()}`,
    );
  const bytes = await response.arrayBuffer();
  verifyArchiveDigest(chartName, release.version, release.digest, bytes);
  const archive = path.join(
    temporaryDirectory,
    `${chartName}-${release.version}.tgz`,
  );
  await Bun.write(archive, bytes);
  const extracted = path.join(
    temporaryDirectory,
    `${chartName}-${release.version}`,
  );
  await extractArchive(archive, extracted);
  const chartDirectory = path.join(extracted, chartName);
  return {
    version: release.version,
    fingerprint: await fingerprintChart(
      chartDirectory,
      path.join(chartDirectory, "templates", `${chartName}.k8s.yaml`),
    ),
    digest: `sha256:${release.digest}`,
  };
}

async function fetchLatestPublishedRevision(
  chartName: string,
): Promise<string> {
  const release = await fetchChartMuseumRelease(chartName);
  if (release === undefined)
    throw new Error(
      `ChartMuseum has no published build revision for ${chartName}`,
    );
  return release.version;
}

/** Active repository charts this checkout does not build keep their newest published revision. */
export async function retainedChartRevisions(
  activeRepositoryCharts: ReadonlySet<string>,
  inputs: readonly ChartInput[],
): Promise<Map<string, string>> {
  const localChartNames = new Set(inputs.map((input) => input.name));
  const retainedCharts = [...activeRepositoryCharts].filter(
    (chart) => !localChartNames.has(chart),
  );
  return new Map(
    await Promise.all(
      retainedCharts.map(
        async (chart) =>
          [chart, await fetchLatestPublishedRevision(chart)] as const,
      ),
    ),
  );
}

/** The planner's comparison key for the exact bytes stageChart packaged, recorded on the Delivery artifact. */
export function stagedChartFingerprint(
  name: string,
  temporaryDirectory: string,
): Promise<string> {
  const chartDirectory = path.join(temporaryDirectory, name);
  return fingerprintChart(
    chartDirectory,
    path.join(chartDirectory, "templates", `${name}.k8s.yaml`),
  );
}

/** The content fingerprint the release plan compared for one chart. */
export function plannedFingerprint(
  plan: HelmReleasePlan,
  name: string,
): string {
  const entry =
    plan.selected.find((item) => item.name === name) ??
    plan.skipped.find((item) => item.name === name);
  if (entry === undefined) throw new Error(`No release plan entry for ${name}`);
  return entry.fingerprint;
}

export type ChartPlanningOptions = {
  readonly version: string;
  readonly dryRun: boolean;
  readonly deliveryCatalog: boolean;
  /** ChartMuseum's newest 2.0.0-N release per chart, read without downloading archives. */
  readonly inventory: ReadonlyMap<string, { readonly version: string }>;
  /** Download, verify and fingerprint ChartMuseum's newest archive of a chart. */
  readonly archive: (name: string) => Promise<ChartPlanningBase>;
  readonly client?: ChartPlanningClient;
  /** This producer's main pipeline; Delivery bases come only from earlier ones. */
  readonly pipelineNumber?: number;
};

/**
 * Delivery's newest pending or verified chart of the catalog owner from a
 * pipeline before this one, so back-to-back pipelines retain the previous
 * pipeline's unchanged chart before it qualifies. No such chart, or one
 * registered before content fingerprints existed, means no base: the chart
 * is published once and retained from then on.
 */
export async function deliveryChartBase(
  client: ChartPlanningClient,
  name: string,
  beforePipeline: number,
): Promise<ChartPlanningBase | undefined> {
  const owner = new ServiceIndex().byChart(name);
  if (owner === undefined)
    throw new Error(`Chart ${name} requires a service catalog owner`);
  let artifact: ArtifactVersion;
  try {
    artifact = await client.latestRetainableArtifact({
      serviceId: owner.id,
      component: `chart:${name}`,
      kind: "chart",
      beforePipeline,
    });
  } catch (error) {
    if (error instanceof DeliveryClientError && error.status === 404)
      return undefined;
    throw error;
  }
  if (
    artifact.serviceId !== owner.id ||
    artifact.component !== `chart:${name}` ||
    artifact.kind !== "chart" ||
    artifact.origin.kind !== "first-party" ||
    !BUILD_REVISION_RE.test(artifact.version)
  )
    throw new Error(
      `Delivery chart ${name} differs from its canonical owner, component, or CI revision`,
    );
  if (artifact.contentFingerprint === undefined) return undefined;
  return {
    version: artifact.version,
    fingerprint: artifact.contentFingerprint,
    digest: artifact.digest,
    artifactId: artifact.id,
  };
}

/**
 * With the Delivery catalog, a chart's base is its owner's newest pending or
 * verified Delivery chart, so unchanged bytes are retained by reference
 * instead of republished under a new version. ChartMuseum archives Delivery
 * never registered are never a base; only this same producer's own archive (a
 * retry) is compared directly.
 */
export async function planningBases(
  inputs: readonly ChartInput[],
  options: ChartPlanningOptions,
): Promise<ReadonlyMap<string, ChartPlanningBase>> {
  const bases = new Map<string, ChartPlanningBase>();
  if (options.dryRun) return bases;
  const entries = await Promise.all(
    inputs.map(async (input) => {
      const latest = options.inventory.get(input.name);
      if (!options.deliveryCatalog)
        return [
          input.name,
          latest === undefined ? undefined : await options.archive(input.name),
        ] as const;
      if (latest?.version === options.version)
        return [input.name, await options.archive(input.name)] as const;
      if (options.client === undefined || options.pipelineNumber === undefined)
        throw new Error(
          "Delivery catalog planning requires a Delivery client and this CI pipeline",
        );
      return [
        input.name,
        await deliveryChartBase(
          options.client,
          input.name,
          options.pipelineNumber,
        ),
      ] as const;
    }),
  );
  for (const [name, base] of entries)
    if (base !== undefined) bases.set(name, base);
  return bases;
}

/** A retry may reuse only this same CI producer's verified immutable archive bytes. */
export function retainCurrentProducerArchives(
  publication: ChartPublication | undefined,
  bases: ReadonlyMap<string, ChartPlanningBase>,
  plan: HelmReleasePlan,
  version: string,
): void {
  if (publication === undefined) return;
  for (const skipped of plan.skipped) {
    const archive = bases.get(skipped.name);
    if (archive?.version !== version) continue;
    publication.charts.push({
      name: skipped.name,
      revision: version,
      digest: archive.digest,
      contentFingerprint: archive.fingerprint,
    });
  }
}

/** An unchanged chart is retained by reference to the Delivery artifact it was planned against. */
export function retainDeliveryChartBases(
  publication: ChartPublication | undefined,
  bases: ReadonlyMap<string, ChartPlanningBase>,
  plan: HelmReleasePlan,
  version: string,
): void {
  if (publication === undefined) return;
  for (const skipped of plan.skipped) {
    const base = bases.get(skipped.name);
    if (base === undefined)
      throw new Error(`Skipped chart ${skipped.name} has no planning base`);
    if (base.version === version) continue;
    if (base.artifactId === undefined)
      throw new Error(
        `Retained chart ${skipped.name} has no qualified Delivery artifact`,
      );
    publication.retained.push({
      name: skipped.name,
      revision: base.version,
      digest: base.digest,
      artifactId: base.artifactId,
      contentFingerprint: base.fingerprint,
    });
  }
}

export function validateChartProducerVersion(
  publication: ChartPublication | undefined,
  buildNumber: string,
): void {
  if (
    publication !== undefined &&
    Number(buildNumber) !== 1_000_000 + publication.pipelineNumber
  )
    throw new Error(
      "Chart release number must identify this exact CI producer",
    );
}

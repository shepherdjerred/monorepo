import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { ChartPublication } from "@shepherdjerred/ops-model/chart-publication.ts";
import type { PublishedChart, HelmReleasePlan } from "./helm-release-core.ts";
import {
  imageRegistry,
  firstPartyImageRepository,
} from "@shepherdjerred/version-catalog/image-registry";
import { parseAllDocuments, stringify } from "yaml";
import path from "node:path";

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

/** A qualified CI release cannot inherit an archive from a failed or uncatalogued older producer. */
export function deliveryPlanningBase(
  published: ReadonlyMap<string, PublishedChart>,
  version: string,
  deliveryCatalog: boolean,
): ReadonlyMap<string, PublishedChart> {
  return deliveryCatalog
    ? new Map(
        [...published].filter(([, artifact]) => artifact.version === version),
      )
    : published;
}

/** A retry may reuse only this same CI producer's verified immutable archive bytes. */
export function retainCurrentProducerArchives(
  publication: ChartPublication | undefined,
  published: ReadonlyMap<string, PublishedChart>,
  plan: HelmReleasePlan,
  version: string,
): void {
  if (publication === undefined) return;
  for (const skipped of plan.skipped) {
    const archive = published.get(skipped.name);
    if (archive?.version !== version) continue;
    if (archive.digest === undefined)
      throw new Error(
        "Same-CI chart reuse requires its verified original checksum",
      );
    publication.charts.push({
      name: skipped.name,
      revision: version,
      digest: archive.digest,
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

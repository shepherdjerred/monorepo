import type { ChartPublication } from "@shepherdjerred/ops-model/chart-publication.ts";
import type { PublishedChart, HelmReleasePlan } from "./helm-release-core.ts";

/** Required selection inputs used only by producer lint/render, outside the packaged chart. */
export function chartValidationValues(name: string) {
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

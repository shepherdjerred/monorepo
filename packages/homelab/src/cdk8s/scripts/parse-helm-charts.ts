/** Parse Helm chart information from the language-neutral version catalog. */

import { parseVersionCatalogText } from "@shepherdjerred/version-catalog";

export type ChartInfo = {
  name: string;
  repoUrl: string;
  version: string;
  chartName: string;
  oci?: boolean;
};

function bareVersion(value: string): string {
  const version = value.split("@")[0];
  if (version === undefined || version === "") {
    throw new Error(`chart has no version in ${value}`);
  }
  return version;
}

export async function parseChartInfoFromVersions(
  catalogPath = "../../../version-catalog/src/catalog.json",
): Promise<ChartInfo[]> {
  const catalog = parseVersionCatalogText(await Bun.file(catalogPath).text());
  return catalog.entries
    .filter((entry) => entry.artifactType === "helm-chart")
    .map((entry) => {
      if (!entry.management.managed) {
        throw new Error(`Helm chart ${entry.name} has no management metadata`);
      }
      const repoUrl = entry.management.registryUrl;
      if (repoUrl === undefined) {
        throw new Error(`Helm chart ${entry.name} has no registry URL`);
      }
      const oci = entry.management.datasource === "docker";
      if (oci && entry.management.packageName === undefined) {
        throw new Error(`OCI Helm chart ${entry.name} has no package name`);
      }
      return {
        name: entry.name,
        repoUrl: oci
          ? repoUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
          : repoUrl.replace(/\/$/, ""),
        version: bareVersion(entry.value),
        chartName: entry.management.packageName ?? entry.name,
        ...(oci ? { oci: true } : {}),
      };
    });
}

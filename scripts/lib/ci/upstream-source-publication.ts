import { createDeliveryClient } from "@shepherdjerred/delivery/client";
import {
  parseVersionCatalog,
  type VersionCatalog,
} from "@shepherdjerred/version-catalog";
import type { ArtifactVersion } from "@shepherdjerred/delivery/contract";
import type { OwnerRegistry } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { z } from "zod";
import { readRequiredHandoff } from "./ci-handoff.ts";
import {
  DELIVERY_CATALOG_REGISTRY_HANDOFF,
  parseDeliveryCatalogRegistry,
} from "./image-publication-handoff.ts";
import { componentArtifactsForPublication } from "./delivery-upstream-artifacts.ts";
import { requireEnv } from "../run.ts";

/** Restrict the shared archive job to source entries; chart and image acquisition stays in registration. */
export function sourceOnlyCatalog(catalog: VersionCatalog): VersionCatalog {
  return {
    ...catalog,
    entries: catalog.entries.map((entry) =>
      entry.artifactType === "source" ? entry : { ...entry, component: false },
    ),
  };
}

export async function publishSourceComponents(
  registry: OwnerRegistry,
  catalog: VersionCatalog,
  acquire: (sourceCatalog: VersionCatalog) => Promise<ArtifactVersion[]>,
): Promise<ArtifactVersion[]> {
  return registry === "v1" ? [] : acquire(sourceOnlyCatalog(catalog));
}

/** Acquire upstream sources in the archive producer with its actual CI identity. */
export async function publishUpstreamSources(): Promise<void> {
  const registry = parseDeliveryCatalogRegistry(
    await readRequiredHandoff(DELIVERY_CATALOG_REGISTRY_HANDOFF),
  );
  const artifacts = await publishSourceComponents(
    registry,
    parseVersionCatalog(rawCatalog),
    async (sources) => {
      const client = createDeliveryClient({
        baseUrl: requireEnv("DELIVERY_URL"),
        headers: {
          Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}`,
        },
      });
      return componentArtifactsForPublication(
        client,
        sources,
        {
          repositoryId: z.coerce
            .number()
            .int()
            .positive()
            .parse(requireEnv("CI_REPO_ID")),
          pipelineNumber: z.coerce
            .number()
            .int()
            .positive()
            .parse(requireEnv("CI_PIPELINE_NUMBER")),
          sourceRevision: requireEnv("CI_COMMIT_SHA"),
        },
        {
          registry: "v2",
          credentials: () => {
            throw new Error(
              "Source acquisition must not request chart credentials",
            );
          },
          githubToken: () => requireEnv("GITHUB_DOWNLOAD_TOKEN"),
        },
      );
    },
  );
  console.log(
    `Qualified ${String(artifacts.length)} upstream source artifact(s)`,
  );
}

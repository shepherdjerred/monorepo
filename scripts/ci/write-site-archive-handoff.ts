#!/usr/bin/env bun
/**
 * Combine every static producer's receipts into the `site-artifacts` handoff.
 *
 * Each independent site registers under its own Delivery service, derived
 * from the archive's `site:<bucket>` component and checked against the
 * service catalog here so a bucket without an owner fails in the producing
 * step. Scout's receipts keep their combined-deployment owner.
 */
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";
import { z } from "zod";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import {
  catalogOwnsService,
  isStaticSiteArtifact,
  staticSiteBucket,
  staticSiteServiceId,
} from "../lib/ci/static-site-publications.ts";

export const SITE_ARCHIVE_METADATA_DIRECTORY = ".delivery-artifacts";

const ScoutPublicationSchema = z
  .object({
    serviceId: z.literal("scout-for-lol"),
    artifact: ArtifactInputSchema,
  })
  .strict();

export type SiteArchivePublication = {
  serviceId: string;
  artifact: z.output<typeof ArtifactInputSchema>;
};

export function siteArchivePublications(
  scout: unknown,
  archives: readonly unknown[],
  catalog: Catalog = SERVICE_CATALOG,
): SiteArchivePublication[] {
  const publications: SiteArchivePublication[] = z
    .array(ScoutPublicationSchema)
    .parse(scout);
  for (const raw of archives) {
    const artifact = ArtifactInputSchema.parse(raw);
    if (!isStaticSiteArtifact(artifact))
      throw new Error(
        `Static site handoff requires a site archive, not ${artifact.component}`,
      );
    const serviceId = staticSiteServiceId(staticSiteBucket(artifact.component));
    if (!catalogOwnsService(catalog, serviceId))
      throw new Error(
        `Static site ${artifact.component} requires a service catalog owner ${serviceId}`,
      );
    publications.push({ serviceId, artifact });
  }
  return publications;
}

async function main(): Promise<void> {
  const rawScout: unknown = JSON.parse(
    await readRequiredHandoff("scout-site-artifacts"),
  );
  const files = await Array.fromAsync(
    new Bun.Glob("*.json").scan({
      cwd: SITE_ARCHIVE_METADATA_DIRECTORY,
      onlyFiles: true,
    }),
  );
  const archives: unknown[] = [];
  for (const file of files.sort())
    archives.push(
      await Bun.file(`${SITE_ARCHIVE_METADATA_DIRECTORY}/${file}`).json(),
    );
  await writeJsonHandoff(
    "site-artifacts",
    siteArchivePublications(rawScout, archives),
  );
}

if (import.meta.main) await main();

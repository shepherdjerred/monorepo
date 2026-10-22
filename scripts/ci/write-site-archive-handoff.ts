#!/usr/bin/env bun
/**
 * Combine every static producer's receipts into the `site-artifacts` handoff.
 *
 * Each independent site registers under its own Delivery service, derived
 * from the archive's `site:<bucket>` component and checked against the
 * catalog document here so a bucket without an owner fails in the producing
 * step. Scout's receipts keep their combined-deployment owner.
 */
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import {
  publicationOwners,
  type PublicationOwners,
} from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readRequiredHandoff, writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import {
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
/** v1 accepted Scout receipts under either owner (WP4 deletes it). */
const V1ScoutPublicationSchema = z
  .object({
    serviceId: z.enum(["static-sites", "scout-for-lol"]),
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
  owners: PublicationOwners = publicationOwners("v1"),
): SiteArchivePublication[] {
  if (owners.registry === "v1") {
    // Until the window's catalog flip, every independent site registers under
    // v1's shared static-sites service.
    const publications: SiteArchivePublication[] = z
      .array(V1ScoutPublicationSchema)
      .parse(scout);
    for (const raw of archives)
      publications.push({
        serviceId: "static-sites",
        artifact: ArtifactInputSchema.parse(raw),
      });
    return publications;
  }
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
    if (!owners.owns(serviceId))
      throw new Error(
        `Static site ${artifact.component} requires a service catalog owner ${serviceId}`,
      );
    publications.push({ serviceId, artifact });
  }
  return publications;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: { "catalog-v2": { type: "boolean", default: false } },
  });
  const owners = publicationOwners(values["catalog-v2"] ? "v2" : "v1");
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
    siteArchivePublications(rawScout, archives, owners),
  );
}

if (import.meta.main) await main();

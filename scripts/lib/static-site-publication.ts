import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import type { OwnerRegistry } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { createStaticArchive } from "./static-site-archive.ts";
import { requireEnv } from "./run.ts";
import { publishImmutableArchive } from "./artifacts/immutable-archive.ts";

export const STATIC_ARCHIVE_BUCKET = "delivery-artifacts";
const DigestPattern = /^sha256:[a-f\d]{64}$/u;
const BucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;

export function staticArchiveUri(bucket: string, digest: string): string {
  if (!BucketPattern.test(bucket) || !DigestPattern.test(digest))
    throw new Error("Invalid static archive identity");
  return `s3://${STATIC_ARCHIVE_BUCKET}/sites/${bucket}/${digest.slice("sha256:".length)}.tar`;
}

export function validateStaticArchiveUri(uri: string, digest: string): void {
  const match =
    /^s3:\/\/delivery-artifacts\/sites\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/[a-f\d]{64}\.tar$/u.exec(
      uri,
    );
  if (match?.[1] === undefined || staticArchiveUri(match[1], digest) !== uri)
    throw new Error("Static archive URI does not match its immutable digest");
}

/**
 * The component a site archive registers. v1 names it `site:<bucket>`; the
 * v2 catalog names every archive `archive:<bucket>` (model 4.3), which its
 * site and Scout recipes request. `woodpecker-delivery-catalog-v2-enabled`
 * selects the registry (window step 8).
 */
export function staticSiteComponent(
  bucket: string,
  registry: OwnerRegistry,
): string {
  if (!BucketPattern.test(bucket))
    throw new Error("Invalid static archive identity");
  return registry === "v2" ? `archive:${bucket}` : `site:${bucket}`;
}

export async function publishStaticSiteArchive(input: {
  bucket: string;
  source: string;
  metadataDirectory: string;
  registry: OwnerRegistry;
  requires?: Record<string, string>;
}): Promise<void> {
  const scratch = await mkdtemp(path.join(tmpdir(), "static-site-publish-"));
  try {
    const archive = path.join(scratch, "site.tar");
    const { digest } = await createStaticArchive(input.source, archive);
    const uri = staticArchiveUri(input.bucket, digest);
    await publishImmutableArchive({
      uri,
      digest,
      file: archive,
      readback: path.join(scratch, "readback.tar"),
    });
    const artifact = ArtifactInputSchema.parse({
      id: `ci/${requireEnv("CI_REPO_ID")}/${requireEnv("CI_PIPELINE_NUMBER")}/site/${input.bucket}`,
      component: staticSiteComponent(input.bucket, input.registry),
      kind: "archive",
      uri,
      digest,
      runtimeDigests: [],
      requires: input.requires ?? {},
      version: `build-${requireEnv("CI_PIPELINE_NUMBER")}`,
    });
    await mkdir(input.metadataDirectory, { recursive: true });
    await Bun.write(
      path.join(input.metadataDirectory, `${input.bucket}.json`),
      `${JSON.stringify(artifact)}\n`,
    );
  } finally {
    await rm(scratch, { recursive: true });
  }
}

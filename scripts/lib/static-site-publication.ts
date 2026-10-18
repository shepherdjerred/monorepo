import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
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

export async function publishStaticSiteArchive(input: {
  bucket: string;
  source: string;
  metadataDirectory: string;
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
      component: `site:${input.bucket}`,
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

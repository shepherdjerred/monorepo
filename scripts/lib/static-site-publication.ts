import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactInputSchema } from "@shepherdjerred/delivery/contract";
import {
  createStaticArchive,
  staticArchiveDigest,
} from "./static-site-archive.ts";
import { run, runAllowExit, requireEnv } from "./run.ts";
import { SEAWEEDFS_AWS_ENV, SEAWEEDFS_ENDPOINT } from "./seaweedfs.ts";

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

const commandOptions = {
  env: SEAWEEDFS_AWS_ENV,
  unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
};

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
    const key = uri.slice(`s3://${STATIC_ARCHIVE_BUCKET}/`.length);
    await run(
      [
        "aws",
        "s3api",
        "head-bucket",
        "--bucket",
        STATIC_ARCHIVE_BUCKET,
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
      ],
      commandOptions,
    );
    const publication = await runAllowExit(
      [
        "aws",
        "s3api",
        "put-object",
        "--bucket",
        STATIC_ARCHIVE_BUCKET,
        "--key",
        key,
        "--body",
        archive,
        "--if-none-match",
        "*",
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
        "--no-cli-pager",
      ],
      commandOptions,
    );
    // Read back even after a lost response or precondition failure. Identical
    // bytes are the only acceptable result at this content-addressed location.
    const readback = path.join(scratch, "readback.tar");
    try {
      await run(
        [
          "aws",
          "s3",
          "cp",
          uri,
          readback,
          "--endpoint-url",
          SEAWEEDFS_ENDPOINT,
        ],
        commandOptions,
      );
    } catch {
      throw new Error(
        `Static archive publication is unconfirmed (upload exit ${String(publication.exitCode)})`,
      );
    }
    if ((await staticArchiveDigest(readback)) !== digest)
      throw new Error(
        "Published static archive failed immutable byte readback",
      );
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

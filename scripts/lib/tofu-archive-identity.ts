import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";

const ARCHIVE_BUCKET = "delivery-artifacts";
const DigestPattern = /^sha256:[a-f\d]{64}$/u;

export const TOFU_ARCHIVE_METADATA_DIRECTORY = ".delivery-tofu-artifacts";

export function tofuArchiveServiceId(stack: TofuStack): string {
  return `tofu-${TofuStackSchema.parse(stack)}`;
}

export function tofuArchiveComponent(stack: TofuStack): string {
  return `archive:tofu-${TofuStackSchema.parse(stack)}`;
}

export function tofuArchiveArtifactId(
  repositoryId: number,
  pipelineNumber: number,
  stack: TofuStack,
): string {
  return `ci/${String(repositoryId)}/${String(pipelineNumber)}/tofu/${TofuStackSchema.parse(stack)}`;
}

export function tofuArchiveUri(stack: TofuStack, digest: string): string {
  if (!DigestPattern.test(digest))
    throw new Error("Invalid OpenTofu archive digest");
  return `s3://${ARCHIVE_BUCKET}/tofu/${TofuStackSchema.parse(stack)}/${digest.slice("sha256:".length)}.tar`;
}

export function validateTofuArchiveUri(
  uri: string,
  stack: TofuStack,
  digest: string,
): void {
  if (tofuArchiveUri(stack, digest) !== uri)
    throw new Error(
      `OpenTofu archive URI for ${stack} does not match its immutable digest`,
    );
}

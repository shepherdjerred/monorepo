/**
 * Immutable OpenTofu stack archives.
 *
 * Delivery plans and applies a stack from a content-addressed archive of its
 * exact source rather than from a Git fetch. An archive holds the stack
 * directory under its repository-relative path (lock file and local modules
 * included; local state, data directories, saved plans, tests and the desired
 * state file excluded) plus the external files the stack manifest declares,
 * so the archive is complete for `tofu init -lockfile=readonly` and `plan`.
 */
import { lstat } from "node:fs/promises";
import path from "node:path";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import { STACK_MANIFEST } from "../../packages/homelab/scripts/tofu/tofu-stack-manifest.ts";
import {
  TOFU_STACK_ROOT,
  verifyStackExternalFiles,
} from "../../packages/homelab/scripts/tofu/tofu-external-files.ts";
import {
  createStaticArchive,
  staticArchivePath,
} from "./static-site-archive.ts";

const ARCHIVE_BUCKET = "delivery-artifacts";
const DigestPattern = /^sha256:[a-f\d]{64}$/u;

/** Producer metadata, one `<stack>.json` artifact record per stack. */
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

/** Local working files that are never part of a stack's reviewed source. */
function excludedFromArchive(relative: string): boolean {
  const parts = relative.split("/");
  const name = parts.at(-1) ?? relative;
  return (
    relative === "desired-state.json" ||
    parts[0] === "tests" ||
    parts.includes(".terraform") ||
    name.includes(".tfstate") ||
    name.includes(".tfplan")
  );
}

/**
 * Repository-relative members of one stack archive, sorted.
 *
 * The external files come from the manifest after the stack's own references
 * were checked against it, so an undeclared read fails here instead of
 * producing an archive that cannot plan.
 */
export async function tofuStackArchiveFiles(
  stack: TofuStack,
  repoRoot: string,
): Promise<string[]> {
  const name = TofuStackSchema.parse(stack);
  const prefix = `${TOFU_STACK_ROOT}/${name}`;
  const directory = path.join(repoRoot, prefix);
  const files: string[] = [];
  for await (const relative of new Bun.Glob("**/*").scan({
    cwd: directory,
    onlyFiles: false,
    dot: true,
    followSymlinks: false,
  })) {
    if (excludedFromArchive(relative)) continue;
    const stats = await lstat(path.join(directory, relative));
    if (stats.isDirectory()) continue;
    if (!stats.isFile())
      throw new Error(
        `OpenTofu archives require regular files: ${prefix}/${relative}`,
      );
    files.push(staticArchivePath(`${prefix}/${relative}`));
  }
  if (!files.some((file) => file.endsWith(".tf")))
    throw new Error(`OpenTofu stack ${name} has no configuration to archive`);
  const { externalFiles } = STACK_MANIFEST[name];
  await verifyStackExternalFiles({
    repoRoot,
    stackDirectory: directory,
    declared: externalFiles,
  });
  for (const external of externalFiles) files.push(staticArchivePath(external));
  return [...new Set(files)].sort();
}

/** Deterministic tar of one stack: same source bytes give the same digest regardless of timestamps. */
export async function createTofuStackArchive(
  stack: TofuStack,
  repoRoot: string,
  output: string,
): Promise<{ digest: string; files: string[] }> {
  const files = await tofuStackArchiveFiles(stack, repoRoot);
  return createStaticArchive(repoRoot, output, files);
}

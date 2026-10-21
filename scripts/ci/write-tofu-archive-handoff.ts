#!/usr/bin/env bun
/**
 * Hand the archive producer's receipts to Delivery registration.
 *
 * One `tofu-<stack>` service per record; the handoff is rejected unless every
 * stack is present, so a producer that silently skipped one cannot register a
 * partial set as a complete run.
 */
import path from "node:path";
import { writeJsonHandoff } from "../lib/ci/ci-handoff.ts";
import {
  parseTofuArchivePublications,
  TOFU_ARCHIVE_HANDOFF,
} from "../lib/ci/delivery-tofu-publication.ts";
import {
  TOFU_ARCHIVE_METADATA_DIRECTORY,
  tofuArchiveServiceId,
} from "../lib/tofu-archive.ts";
import { parseTofuStack } from "../../packages/homelab/scripts/tofu/tofu-stack-manifest.ts";

/** `<stack>.json` records become `{ serviceId: "tofu-<stack>", artifact }` entries. */
export async function readTofuArchiveMetadata(
  directory: string,
): Promise<{ serviceId: string; artifact: unknown }[]> {
  const files = await Array.fromAsync(
    new Bun.Glob("*.json").scan({ cwd: directory, onlyFiles: true }),
  );
  const records = [];
  for (const file of files.sort()) {
    const stack = parseTofuStack(path.basename(file, ".json"));
    const artifact: unknown = await Bun.file(path.join(directory, file)).json();
    records.push({ serviceId: tofuArchiveServiceId(stack), artifact });
  }
  return records;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dir, "../..");
  const publications = parseTofuArchivePublications(
    await readTofuArchiveMetadata(
      path.join(repoRoot, TOFU_ARCHIVE_METADATA_DIRECTORY),
    ),
  );
  await writeJsonHandoff(TOFU_ARCHIVE_HANDOFF, publications);
}

if (import.meta.main) await main();

// Raw official patch-notes pages, committed for provenance and read by the
// deterministic patch-changes parser. Never imported at runtime.

import { readdir } from "node:fs/promises";
import type { RiotPatch } from "./riot-patch.ts";

export const PATCH_NOTES_ARCHIVE_DIR = `${import.meta.dir}/../patch-notes-archive`;

const ARCHIVE_FILE_PATTERN = /^(\d+\.\d+)\.html$/;

export async function archivePatchNotes(
  patch: Pick<RiotPatch, "patch">,
  html: string,
  dir: string = PATCH_NOTES_ARCHIVE_DIR,
): Promise<void> {
  await Bun.write(`${dir}/${patch.patch}.html`, html);
  console.log(`✓ Archived raw patch ${patch.patch} notes`);
}

/** Patch numbers (e.g. "26.19") that already have an archived page. */
export async function listArchivedPatches(
  dir: string = PATCH_NOTES_ARCHIVE_DIR,
): Promise<Set<string>> {
  const patches = new Set<string>();
  for (const name of await readdir(dir)) {
    const patch = ARCHIVE_FILE_PATTERN.exec(name)?.[1];
    if (patch !== undefined) {
      patches.add(patch);
    }
  }
  return patches;
}

/**
 * Archive the fetched page, then analyze it. The order is the point: the model
 * call is the step that fails (credentials, timeout, bad output), and the
 * archive is the input of the deterministic parser, so it must already be on
 * disk when analysis throws.
 */
export async function archiveThenAnalyze<T>(
  patch: RiotPatch,
  html: string,
  analyze: (patch: RiotPatch, html: string) => Promise<T>,
  archive: (patch: RiotPatch, html: string) => Promise<void> = (
    archivedPatch,
    archivedHtml,
  ) => archivePatchNotes(archivedPatch, archivedHtml),
): Promise<T> {
  await archive(patch, html);
  return await analyze(patch, html);
}

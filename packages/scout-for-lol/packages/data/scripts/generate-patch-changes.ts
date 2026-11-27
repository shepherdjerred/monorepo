#!/usr/bin/env bun
// Regenerate `src/data-dragon/assets/patch-changes.generated.json` from the
// archived official patch-notes pages. Deterministic: no network, no model.
//
//   bun run scripts/generate-patch-changes.ts --write   regenerate the file
//   bun run scripts/generate-patch-changes.ts --check   fail if it is stale

import { resolve } from "node:path";
import {
  mergePatchChanges,
  patchChangesFromHtml,
} from "#src/data-dragon/patch-changes-build.ts";
import type { PatchChanges } from "#src/data-dragon/patch-changes-schema.ts";
import { PATCH_NOTES_ARCHIVE_DIR } from "./patch-notes-archive.ts";

export const PATCH_CHANGES_ASSET = resolve(
  import.meta.dir,
  "../src/data-dragon/assets/patch-changes.generated.json",
);

export async function generatePatchChangesJson(
  archiveDir: string = PATCH_NOTES_ARCHIVE_DIR,
): Promise<string> {
  const perPatch: PatchChanges[] = [];
  const files = [
    ...new Bun.Glob("*.html").scanSync({ cwd: archiveDir }),
  ].toSorted();
  for (const file of files) {
    const html = await Bun.file(resolve(archiveDir, file)).text();
    const changes = await patchChangesFromHtml(html);
    const expected = file.replace(/\.html$/, "");
    for (const change of changes) {
      if (change.patch !== expected) {
        throw new Error(
          `${file} holds patch ${change.patch}; the archive name must match the page`,
        );
      }
    }
    perPatch.push(changes);
  }
  return `${JSON.stringify(mergePatchChanges(perPatch), null, 2)}\n`;
}

export async function writePatchChanges(): Promise<void> {
  await Bun.write(PATCH_CHANGES_ASSET, await generatePatchChangesJson());
  console.log(`✓ Wrote ${PATCH_CHANGES_ASSET}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: generate-patch-changes.ts --write | --check");
  }
  if (mode === "--write") {
    await writePatchChanges();
    return;
  }
  const generated = await generatePatchChangesJson();
  const committed = await Bun.file(PATCH_CHANGES_ASSET).text();
  if (committed !== generated) {
    throw new Error(
      "patch-changes.generated.json is stale; run `bun run generate:patch-changes`",
    );
  }
  console.log("✓ patch-changes.generated.json is up to date");
}

if (import.meta.main) {
  await main();
}

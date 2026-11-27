#!/usr/bin/env bun
// Archive the official patch-notes pages missing from `patch-notes-archive/`.
//
// No model call: this only fetches and stores raw HTML, which the deterministic
// patch-changes parser (`src/data-dragon/patch-changes-parser.ts`) reads.
// Sequential with a pause between pages so it stays polite to the source.
//
//   bun run backfill-patch-notes [--from 26.14] [--delay-ms 1500]

import { parseArgs } from "node:util";
import { fetchOfficialPatchNotes } from "./patch-analysis.ts";
import {
  archivePatchNotes,
  listArchivedPatches,
} from "./patch-notes-archive.ts";
import { fetchPatches, type RiotPatch } from "./riot-patch.ts";

const DEFAULT_FROM = "26.14";
const DEFAULT_DELAY_MS = 1500;

function parsePatchNumber(value: string): { major: number; minor: number } {
  const match = /^(\d+)\.(\d+)$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Expected a patch like 26.14, received ${value}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function selectMissingPatches(
  patches: readonly RiotPatch[],
  archived: ReadonlySet<string>,
  from: string,
): RiotPatch[] {
  const floor = parsePatchNumber(from);
  return patches
    .filter(
      (patch) =>
        !archived.has(patch.patch) &&
        (patch.major > floor.major ||
          (patch.major === floor.major && patch.minor >= floor.minor)),
    )
    .sort(
      (left, right) => left.major - right.major || left.minor - right.minor,
    );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: "string", default: DEFAULT_FROM },
      "delay-ms": { type: "string", default: String(DEFAULT_DELAY_MS) },
    },
  });
  const delayMs = Number(values["delay-ms"]);
  if (!Number.isInteger(delayMs) || delayMs < 0) {
    throw new Error(`--delay-ms must be a non-negative integer`);
  }

  const missing = selectMissingPatches(
    await fetchPatches(),
    await listArchivedPatches(),
    values.from,
  );
  console.log(
    `Missing patch notes: ${missing.map((patch) => patch.patch).join(", ") || "none"}`,
  );

  for (const [index, patch] of missing.entries()) {
    if (index > 0) {
      await sleep(delayMs);
    }
    await archivePatchNotes(patch, await fetchOfficialPatchNotes(patch));
  }
}

if (import.meta.main) {
  await main();
}

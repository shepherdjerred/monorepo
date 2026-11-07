import assert from "node:assert/strict";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const mutationOwnerMarker = ".facet-local-mutation-owner";

export async function initializeMutationOwner(
  vault: string,
  runID: string,
): Promise<void> {
  z.uuid().parse(runID);
  assert.equal(await realpath(vault), vault, "Owned vault must be canonical.");
  await writeFile(path.join(vault, mutationOwnerMarker), runID + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

export async function requireMutationOwner(
  vault: string,
  runID: string,
): Promise<void> {
  z.uuid().parse(runID);
  assert.equal(await realpath(vault), vault, "Owned vault must be canonical.");
  const marker = path.join(vault, mutationOwnerMarker);
  const metadata = await lstat(marker);
  assert.ok(
    metadata.isFile() && !metadata.isSymbolicLink(),
    "Owned marker must be a regular unlinked file.",
  );
  assert.equal(
    await readFile(marker, "utf8"),
    runID + "\n",
    "Owned marker must retain its exact run identity.",
  );
}

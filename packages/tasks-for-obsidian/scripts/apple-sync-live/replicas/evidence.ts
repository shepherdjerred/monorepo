import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { runDirectory, type Manifest } from "../model";
import { guestReadFiles } from "../transport/client";
import { safeVaultPath } from "./access";

/** Retained guest evidence is proof, never a readable synchronization replica. */
export async function retainGuestEvidence(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  relatives: string[],
) {
  assert.ok(
    relatives.length > 0 &&
      relatives.length <= 20_000 &&
      new Set(relatives).size === relatives.length,
  );
  const directory = runDirectory(manifest.runID);
  for (let offset = 0; offset < relatives.length; offset += 64) {
    const selected = relatives.slice(offset, offset + 64);
    selected.forEach((relative) => safeVaultPath(relative));
    const files = await guestReadFiles(manifest, "evidence", selected);
    assert.deepEqual(Object.keys(files).sort(), selected.toSorted());
    for (const relative of selected) {
      assert.ok(
        relative.startsWith(`journeys/round-${String(manifest.round)}/`) ||
          relative.startsWith(`official-ui/round-${String(manifest.round)}/`),
      );
      const destination = path.join(directory, relative);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      assert.equal(
        await realpath(path.dirname(destination)),
        path.dirname(destination),
      );
      const bytes = files[relative];
      assert.ok(bytes !== undefined);
      await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    }
  }
}

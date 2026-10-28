import assert from "node:assert/strict";
import path from "node:path";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import {
  StatusSchema,
  clientState,
  type Manifest,
} from "../../apple-sync-live/model";

/** Wait for evidence from this normal cold launch, never a stale pre-launch status. */
export async function awaitFreshIOSPublication(
  manifest: Manifest,
  launchedAt: number,
) {
  const deadline = Date.now() + 30_000;
  const file = path.join(
    clientState(manifest, "ios").stateDirectory,
    "control/status.json",
  );
  for (;;) {
    try {
      const status = StatusSchema.parse(await readOwnedMacVMJSON(file));
      assert.equal(status.runID.toLowerCase(), manifest.runID.toLowerCase());
      const captured = Date.parse(status.capturedAt);
      if (captured >= launchedAt && Date.now() - captured <= 5000) return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    assert.ok(
      Date.now() < deadline,
      "Owned iOS app did not publish fresh post-launch status",
    );
    await Bun.sleep(100);
  }
}

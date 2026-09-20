import { asRecord } from "../../../scripts/lib/json.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";

export type LiveCatalogExecutor = (
  command: readonly string[],
) => Promise<BuildxCommandResult>;

/**
 * Reads the version catalog from live origin/main. The image push records it
 * as build metadata and derives Temporal Workflow candidate pins from it.
 *
 * Candidate safety comes from the pin rules in pin-candidate-images.ts: a new
 * candidate is published only while stable and candidate are converged, so a
 * candidate that is ramping is never replaced. A pending version-bump branch
 * does not need to be waited on; commit-back merges pending state per pin and
 * the newer build wins, which only ever replaces a candidate nobody ramped.
 */
export async function readLiveVersionCatalogSource(
  executor: LiveCatalogExecutor,
): Promise<string> {
  const fetched = await executor(["git", "fetch", "origin", "main"]);
  if (fetched.exitCode !== 0) {
    throw new TransientError(
      "Unable to refresh origin/main before reading the version catalog",
    );
  }
  const catalog = await executor([
    "git",
    "show",
    `origin/main:${VERSION_CATALOG_PATH}`,
  ]);
  if (catalog.exitCode !== 0) {
    throw new TransientError("Unable to read the live version catalog");
  }
  const parsed = asRecord(JSON.parse(catalog.stdout));
  if (parsed === null || !Array.isArray(parsed["entries"])) {
    throw new Error("Live version catalog has an invalid shape");
  }
  for (const entryValue of parsed["entries"]) {
    const entry = asRecord(entryValue);
    if (
      entry === null ||
      typeof entry["name"] !== "string" ||
      typeof entry["value"] !== "string"
    ) {
      throw new Error("Live version catalog has an invalid entry");
    }
  }
  return catalog.stdout;
}

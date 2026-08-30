import { asRecord } from "../../scripts/lib/json.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";
import { TransientError } from "../../scripts/lib/transient-error.ts";

const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
export const TEMPORAL_WORKFLOW_PIN_PAIRS = [
  [
    "shepherdjerred/temporal-worker/workflows/stable",
    "shepherdjerred/temporal-worker/workflows/candidate",
  ],
  [
    "shepherdjerred/scout-for-lol/beta/workflows/stable",
    "shepherdjerred/scout-for-lol/beta/workflows/candidate",
  ],
] as const;
type TemporalWorkflowPinPair = (typeof TEMPORAL_WORKFLOW_PIN_PAIRS)[number];
type LiveVersionCatalog = {
  readonly source: string;
  readonly values: ReadonlyMap<string, string>;
};

export type CandidateAdmissionExecutor = (
  command: readonly string[],
) => Promise<BuildxCommandResult>;

async function readLiveVersionCatalog(
  executor: CandidateAdmissionExecutor,
): Promise<LiveVersionCatalog> {
  const fetched = await executor(["git", "fetch", "origin", "main"]);
  if (fetched.exitCode !== 0) {
    throw new TransientError(
      "Unable to refresh origin/main before Temporal candidate admission",
    );
  }
  const catalog = await executor([
    "git",
    "show",
    `origin/main:${VERSION_CATALOG_PATH}`,
  ]);
  if (catalog.exitCode !== 0) {
    throw new TransientError(
      "Unable to read the live version catalog before Temporal candidate admission",
    );
  }
  const parsed = asRecord(JSON.parse(catalog.stdout));
  if (parsed === null || !Array.isArray(parsed["entries"])) {
    throw new Error("Live version catalog has an invalid shape");
  }
  const values = new Map<string, string>();
  for (const entryValue of parsed["entries"]) {
    const entry = asRecord(entryValue);
    if (
      entry === null ||
      typeof entry["name"] !== "string" ||
      typeof entry["value"] !== "string"
    ) {
      throw new Error("Live version catalog has an invalid entry");
    }
    values.set(entry["name"], entry["value"]);
  }
  return { source: catalog.stdout, values };
}

export async function assertTemporalCandidatePinsConverged(
  executor: CandidateAdmissionExecutor,
  pinPairs: readonly TemporalWorkflowPinPair[] = TEMPORAL_WORKFLOW_PIN_PAIRS,
): Promise<string> {
  const catalog = await readLiveVersionCatalog(executor);
  for (const [stable, candidate] of pinPairs) {
    const stableValue = catalog.values.get(stable);
    const candidateValue = catalog.values.get(candidate);
    if (stableValue === undefined || candidateValue === undefined) {
      throw new Error(
        `Version catalog is missing Temporal workflow pins for ${stable}`,
      );
    }
    if (stableValue !== candidateValue) {
      throw new TransientError(
        `Temporal candidate ${candidate} is active in origin/main; wait for its ramp or promotion before publishing another candidate`,
      );
    }
  }
  return catalog.source;
}

export async function assertNoPendingVersionBump(
  executor: CandidateAdmissionExecutor,
): Promise<string> {
  const result = await executor([
    "git",
    "ls-remote",
    "origin",
    `refs/heads/${VERSION_BUMP_BRANCH}`,
  ]);
  if (result.exitCode !== 0) {
    throw new TransientError(
      `Unable to check ${VERSION_BUMP_BRANCH} before candidate admission`,
    );
  }
  if (result.stdout.trim() !== "") {
    throw new TransientError(
      `${VERSION_BUMP_BRANCH} is still pending; retry after its catalog update merges`,
    );
  }
  const catalog = await readLiveVersionCatalog(executor);
  return catalog.source;
}

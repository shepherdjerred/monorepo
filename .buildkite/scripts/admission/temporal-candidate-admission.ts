import { asRecord } from "../../../scripts/lib/json.ts";
import type { BuildxCommandResult } from "../images/bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

const VERSION_BUMP_BRANCH = "chore/version-bump-pending";
const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const CENTRAL_WORKFLOW_STABLE =
  "shepherdjerred/temporal-worker/workflows/stable";
const CENTRAL_WORKFLOW_CANDIDATE =
  "shepherdjerred/temporal-worker/workflows/candidate";
const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;
export const TEMPORAL_WORKFLOW_PIN_PAIRS: readonly (readonly [
  string,
  string,
])[] = [
  [
    "shepherdjerred/temporal-worker/workflows/stable",
    "shepherdjerred/temporal-worker/workflows/candidate",
  ],
];
type TemporalWorkflowPinPair = readonly [string, string];
type LiveVersionCatalog = {
  readonly source: string;
  readonly values: ReadonlyMap<string, string>;
};

function isLegacyWorkflowPin(value: string): boolean {
  const match = /^2\.0\.0-(\d+)@sha256:[a-f\d]{64}$/.exec(value);
  if (match === null) return false;
  const build = Number(match[1]);
  return Number.isInteger(build) && build <= LAST_IMAGE_WITHOUT_WORKFLOW_WORKER;
}

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
    if (
      stableValue !== candidateValue &&
      !(
        stable === CENTRAL_WORKFLOW_STABLE &&
        !isLegacyWorkflowPin(stableValue) &&
        isLegacyWorkflowPin(candidateValue)
      )
    ) {
      throw new TransientError(
        `Temporal candidate ${candidate} is active in origin/main; wait for its ramp or promotion before publishing another candidate`,
      );
    }
  }
  return catalog.source;
}

function willPublishTemporalWorkflowCandidate(
  catalog: LiveVersionCatalog,
): boolean {
  const stable = catalog.values.get(CENTRAL_WORKFLOW_STABLE);
  const candidate = catalog.values.get(CENTRAL_WORKFLOW_CANDIDATE);
  if (stable === undefined || candidate === undefined) return true;
  return (
    stable === candidate ||
    (!isLegacyWorkflowPin(stable) && isLegacyWorkflowPin(candidate))
  );
}

/**
 * A pending version bump only matters when this build is about to publish a new
 * Temporal Workflow candidate: that decision reads the stable/candidate pin pair
 * off live main, and an unmerged bump means the pair it reads is not the pair
 * that will exist once the bump lands.
 *
 * The check used to run unconditionally, before the catalog was even read, which
 * made every image build wait on a branch it had no stake in. Because
 * `version commit-back` opens that branch after *every* main build, and the
 * bump's own CI takes longer than the exit-34 retry budget, an ordinary build
 * could only pass in the narrow window between one bump merging and the next
 * being opened — so main went red on a scheduling race rather than on a defect.
 *
 * Narrowing it keeps the invariant that motivated it (never decide candidate
 * admission from a catalog a pending bump is about to change) and drops the
 * blocking that never protected anything.
 */
export async function assertNoPendingVersionBump(
  executor: CandidateAdmissionExecutor,
  enforceTemporalCandidateAdmission = true,
): Promise<string> {
  const catalog = await readLiveVersionCatalog(executor);
  if (
    !enforceTemporalCandidateAdmission ||
    !willPublishTemporalWorkflowCandidate(catalog)
  ) {
    return catalog.source;
  }
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
  return assertTemporalCandidatePinsConverged(executor);
}

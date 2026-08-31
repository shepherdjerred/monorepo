import { requireCatalogImageValue } from "../../scripts/lib/image-pin-catalog.ts";

const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;
const CENTRAL_WORKFLOW_STABLE =
  "shepherdjerred/temporal-worker/workflows/stable";
const CENTRAL_WORKFLOW_CANDIDATE =
  "shepherdjerred/temporal-worker/workflows/candidate";
const SCOUT_BETA_WORKFLOW_STABLE =
  "shepherdjerred/scout-for-lol/beta/workflows/stable";
const SCOUT_BETA_WORKFLOW_CANDIDATE =
  "shepherdjerred/scout-for-lol/beta/workflows/candidate";

function isLegacyWorkflowPin(value: string): boolean {
  const match = /^2\.0\.0-(\d+)@sha256:[a-f\d]{64}$/.exec(value);
  if (match === null) return false;
  const build = Number(match[1]);
  return Number.isInteger(build) && build <= LAST_IMAGE_WITHOUT_WORKFLOW_WORKER;
}

function centralWorkflowPinTargets(
  versionCatalogSource: string,
): readonly string[] {
  const stable = requireCatalogImageValue(
    versionCatalogSource,
    CENTRAL_WORKFLOW_STABLE,
  );
  const candidate = requireCatalogImageValue(
    versionCatalogSource,
    CENTRAL_WORKFLOW_CANDIDATE,
  );
  if (stable === candidate && isLegacyWorkflowPin(stable)) {
    return [CENTRAL_WORKFLOW_STABLE, CENTRAL_WORKFLOW_CANDIDATE];
  }
  if (
    stable === candidate ||
    (!isLegacyWorkflowPin(stable) && isLegacyWorkflowPin(candidate))
  ) {
    return [CENTRAL_WORKFLOW_CANDIDATE];
  }
  return [];
}

function scoutBetaWorkflowPinTargets(
  versionCatalogSource: string,
): readonly string[] {
  const stable = requireCatalogImageValue(
    versionCatalogSource,
    SCOUT_BETA_WORKFLOW_STABLE,
  );
  const candidate = requireCatalogImageValue(
    versionCatalogSource,
    SCOUT_BETA_WORKFLOW_CANDIDATE,
  );
  if (stable === candidate && isLegacyWorkflowPin(stable)) {
    return [SCOUT_BETA_WORKFLOW_STABLE, SCOUT_BETA_WORKFLOW_CANDIDATE];
  }
  if (
    stable === candidate ||
    (!isLegacyWorkflowPin(stable) && isLegacyWorkflowPin(candidate))
  ) {
    return [SCOUT_BETA_WORKFLOW_CANDIDATE];
  }
  return [];
}

export function pinCandidatesForDigests(
  digests: Readonly<Record<string, string>>,
  buildNumber: string,
  versionCatalogSource: string,
): Record<string, { version: string; digest: string }> {
  const candidates: Record<string, { version: string; digest: string }> = {};
  for (const [key, digest] of Object.entries(digests)) {
    const candidate = { version: `2.0.0-${buildNumber}`, digest };
    candidates[key] = candidate;
    if (key === "shepherdjerred/temporal-worker") {
      for (const target of centralWorkflowPinTargets(versionCatalogSource)) {
        candidates[target] = candidate;
      }
    }
    if (key === "shepherdjerred/scout-for-lol/beta") {
      for (const target of scoutBetaWorkflowPinTargets(versionCatalogSource)) {
        candidates[target] = candidate;
      }
    }
  }
  return candidates;
}

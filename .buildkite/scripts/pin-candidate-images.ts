import { requireCatalogImageValue } from "../../scripts/lib/image-pin-catalog.ts";

const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;
const WORKFLOW_STABLE = "shepherdjerred/temporal-worker/workflows/stable";
const WORKFLOW_CANDIDATE = "shepherdjerred/temporal-worker/workflows/candidate";

function isLegacyWorkflowPin(value: string): boolean {
  const match = /^2\.0\.0-(\d+)@sha256:[a-f\d]{64}$/.exec(value);
  if (match === null) return false;
  const build = Number(match[1]);
  return Number.isInteger(build) && build <= LAST_IMAGE_WITHOUT_WORKFLOW_WORKER;
}

function workflowPinTargets(versionCatalogSource: string): readonly string[] {
  const stable = requireCatalogImageValue(
    versionCatalogSource,
    WORKFLOW_STABLE,
  );
  const candidate = requireCatalogImageValue(
    versionCatalogSource,
    WORKFLOW_CANDIDATE,
  );
  if (stable === candidate && isLegacyWorkflowPin(stable)) {
    return [WORKFLOW_STABLE];
  }
  if (
    stable === candidate ||
    (!isLegacyWorkflowPin(stable) && isLegacyWorkflowPin(candidate))
  ) {
    return [WORKFLOW_CANDIDATE];
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
      for (const target of workflowPinTargets(versionCatalogSource)) {
        candidates[target] = candidate;
      }
    }
  }
  return candidates;
}

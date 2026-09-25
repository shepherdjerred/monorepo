import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/);
const BuildVersionSchema = z.string().regex(/^2\.0\.0-\d+$/);
const ImageDigestsSchema = z.record(z.string().min(1), DigestSchema);
const ChartRevisionsSchema = z.record(z.string().min(1), BuildVersionSchema);
const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function workflowStableKey(candidate: string): string | undefined {
  return candidate.endsWith("/workflows/candidate")
    ? candidate.replace("/workflows/candidate", "/workflows/stable")
    : undefined;
}

function isLegacyWorkflowPin(value: string): boolean {
  const match = /^2\.0\.0-(\d+)@sha256:[a-f\d]{64}$/.exec(value);
  if (match === null) return false;
  const build = Number(match[1]);
  return Number.isInteger(build) && build <= LAST_IMAGE_WITHOUT_WORKFLOW_WORKER;
}

function canUpdateImagePin(
  versions: Readonly<Record<string, string>>,
  candidate: string,
): boolean {
  const stableKey = workflowStableKey(candidate);
  if (stableKey === undefined || !Object.hasOwn(versions, stableKey)) {
    return true;
  }
  const stableVersion = versions[stableKey];
  const candidateVersion = versions[candidate];
  return (
    stableVersion === candidateVersion ||
    (stableVersion !== undefined &&
      candidateVersion !== undefined &&
      isLegacyWorkflowPin(candidateVersion) &&
      !isLegacyWorkflowPin(stableVersion))
  );
}

function applyImagePin(
  versions: Record<string, string>,
  candidate: string,
  version: string,
): void {
  versions[candidate] = version;
}

function applyDigestOverride(
  versions: Record<string, string>,
  imageKey: string,
  digest: string,
  releaseVersion: string,
): boolean {
  const candidates = [
    imageKey,
    `${imageKey}/beta`,
    `${imageKey}/workflows/candidate`,
    `${imageKey}/beta/workflows/candidate`,
  ];
  let matched = false;
  for (const candidate of candidates) {
    if (!Object.hasOwn(versions, candidate)) {
      continue;
    }
    if (!canUpdateImagePin(versions, candidate)) {
      continue;
    }
    const nextVersion = `${releaseVersion}@${digest}`;
    const stableKey = workflowStableKey(candidate);
    const previousVersion = versions[candidate];
    if (previousVersion === undefined) {
      throw new Error(`Missing image pin for ${candidate}`);
    }
    if (
      stableKey !== undefined &&
      Object.hasOwn(versions, stableKey) &&
      versions[stableKey] === previousVersion &&
      isLegacyWorkflowPin(previousVersion)
    ) {
      applyImagePin(versions, stableKey, nextVersion);
      matched = true;
      continue;
    }
    applyImagePin(versions, candidate, nextVersion);
    matched = true;
  }
  return matched;
}

export function applyCurrentBuildImageOverrides(
  versions: Record<string, string>,
  rawDigests: string | undefined = Bun.env["HOMELAB_IMAGE_DIGESTS_JSON"],
  buildVersion: string | undefined = Bun.env["HOMELAB_RELEASE_VERSION"],
): void {
  if (rawDigests === undefined) {
    return;
  }
  const digests = ImageDigestsSchema.parse(
    parseJson(rawDigests, "HOMELAB_IMAGE_DIGESTS_JSON"),
  );
  if (Object.keys(digests).length === 0) {
    return;
  }
  const releaseVersion = BuildVersionSchema.parse(buildVersion);
  for (const [imageKey, digest] of Object.entries(digests)) {
    if (!applyDigestOverride(versions, imageKey, digest, releaseVersion)) {
      throw new Error(
        `Current-build image ${imageKey} does not match a bare or beta versions.ts entry`,
      );
    }
  }
}

export function releaseChartRevisions(
  raw: string | undefined = Bun.env["HOMELAB_CHART_REVISIONS_JSON"],
): Readonly<Record<string, string>> | undefined {
  return raw === undefined
    ? undefined
    : ChartRevisionsSchema.parse(
        parseJson(raw, "HOMELAB_CHART_REVISIONS_JSON"),
      );
}

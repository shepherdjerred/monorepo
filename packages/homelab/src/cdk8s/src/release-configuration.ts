import { z } from "zod";
import {
  SCOUT_POSTGRES_IMAGE_NOTE,
  type VersionCatalog,
} from "@shepherdjerred/version-catalog";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/);
const BuildVersionSchema = z.string().regex(/^2\.0\.0-\d+$/);
const ScoutImageVersionSchema = z
  .string()
  .regex(/^2\.0\.0-\d+(?:@sha256:[a-f\d]{64})?$/);
const ImageDigestsSchema = z.record(z.string().min(1), DigestSchema);
const ChartRevisionsSchema = z.record(z.string().min(1), BuildVersionSchema);
const ScoutImageDigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/);
const LAST_IMAGE_WITHOUT_WORKFLOW_WORKER = 12_197;

/**
 * A version is PostgreSQL-backed only when its immutable digest is present in
 * the catalog's durable contract marker or in the current image-build
 * handoff. Release numbers alone do not carry enough provenance.
 */
export function scoutImageUsesPostgres(
  version: string,
  postgresImageDigests: ReadonlySet<string>,
): boolean {
  const parsed = ScoutImageVersionSchema.parse(version);
  const digest = parsed.split("@")[1];
  return digest !== undefined && postgresImageDigests.has(digest);
}

export function catalogScoutPostgresImageDigests(
  catalog: VersionCatalog,
): ReadonlySet<string> {
  const digests = new Set<string>();
  for (const entry of catalog.entries) {
    if (!entry.name.startsWith("shepherdjerred/scout-for-lol/")) {
      continue;
    }
    for (const note of entry.notes ?? []) {
      if (note === SCOUT_POSTGRES_IMAGE_NOTE) {
        const digest = entry.value.split("@")[1];
        if (digest === undefined) {
          throw new Error(
            `${entry.name} has a PostgreSQL contract but no digest`,
          );
        }
        digests.add(ScoutImageDigestSchema.parse(digest));
        continue;
      }
      const prefix = `${SCOUT_POSTGRES_IMAGE_NOTE} `;
      if (!note.startsWith(prefix)) {
        continue;
      }
      digests.add(ScoutImageDigestSchema.parse(note.slice(prefix.length)));
    }
  }
  return digests;
}

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
  return (
    stableKey === undefined ||
    !Object.hasOwn(versions, stableKey) ||
    versions[stableKey] === versions[candidate]
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
    applyImagePin(versions, candidate, nextVersion);
    if (
      stableKey !== undefined &&
      Object.hasOwn(versions, stableKey) &&
      versions[stableKey] === previousVersion &&
      isLegacyWorkflowPin(previousVersion)
    ) {
      // The first capable release must seed both tracks atomically; otherwise
      // the stable track remains an image that cannot start a versioned worker.
      applyImagePin(versions, stableKey, nextVersion);
    }
    matched = true;
  }
  return matched;
}

export function applyCurrentBuildImageOverrides(
  versions: Record<string, string>,
  rawDigests: string | undefined = Bun.env["HOMELAB_IMAGE_DIGESTS_JSON"],
  buildVersion: string | undefined = Bun.env["HOMELAB_RELEASE_VERSION"],
): ReadonlySet<string> {
  const postgresImageDigests = new Set<string>();
  if (rawDigests === undefined) {
    return postgresImageDigests;
  }
  const digests = ImageDigestsSchema.parse(
    parseJson(rawDigests, "HOMELAB_IMAGE_DIGESTS_JSON"),
  );
  if (Object.keys(digests).length === 0) {
    return postgresImageDigests;
  }
  const releaseVersion = BuildVersionSchema.parse(buildVersion);
  for (const [imageKey, digest] of Object.entries(digests)) {
    if (!applyDigestOverride(versions, imageKey, digest, releaseVersion)) {
      throw new Error(
        `Current-build image ${imageKey} does not match a bare or beta versions.ts entry`,
      );
    }
    if (imageKey.startsWith("shepherdjerred/scout-for-lol")) {
      postgresImageDigests.add(digest);
    }
  }
  return postgresImageDigests;
}

export function releaseChartRevisions(
  raw: string | undefined = Bun.env["HOMELAB_CHART_REVISIONS_JSON"],
): Readonly<Record<string, string>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return ChartRevisionsSchema.parse(
    parseJson(raw, "HOMELAB_CHART_REVISIONS_JSON"),
  );
}

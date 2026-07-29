import { z } from "zod";

const DigestSchema = z.string().regex(/^sha256:[a-f\d]{64}$/);
const BuildVersionSchema = z.string().regex(/^2\.0\.0-\d+$/);
const ImageDigestsSchema = z.record(z.string().min(1), DigestSchema);
const ChartRevisionsSchema = z.record(z.string().min(1), BuildVersionSchema);

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
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
    const candidates = [imageKey, `${imageKey}/beta`];
    let matched = false;
    for (const candidate of candidates) {
      if (!Object.hasOwn(versions, candidate)) {
        continue;
      }
      versions[candidate] = `${releaseVersion}@${digest}`;
      matched = true;
    }
    if (!matched) {
      throw new Error(
        `Current-build image ${imageKey} does not match a bare or beta versions.ts entry`,
      );
    }
  }
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

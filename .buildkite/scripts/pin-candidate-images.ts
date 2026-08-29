import { catalogImagePinsMatch } from "../../scripts/lib/image-pin-catalog.ts";

export function pinCandidatesForDigests(
  digests: Readonly<Record<string, string>>,
  buildNumber: string,
  versionCatalogSource: string,
): Record<string, { version: string; digest: string }> {
  const candidates: Record<string, { version: string; digest: string }> = {};
  for (const [key, digest] of Object.entries(digests)) {
    const candidate = { version: `2.0.0-${buildNumber}`, digest };
    candidates[key] = candidate;
    if (
      key === "shepherdjerred/temporal-worker" &&
      catalogImagePinsMatch(
        versionCatalogSource,
        "shepherdjerred/temporal-worker/workflows/candidate",
        "shepherdjerred/temporal-worker/workflows/stable",
      )
    ) {
      candidates["shepherdjerred/temporal-worker/workflows/candidate"] =
        candidate;
    }
  }
  return candidates;
}

import { z } from "zod";
import { snapshotHash } from "./profile-import.ts";

export const LegacyAssetSchema = z.object({
  source: z.enum(["radarr", "sonarr"]),
  sourceInstance: z.string().min(1),
  sourceId: z.number().int().positive(),
  sourceMediaId: z.number().int().positive(),
  externalIds: z.record(z.string(), z.string().min(1)),
  path: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  checksum: z
    .string()
    .regex(/^[a-f\d]{64}$/)
    .nullable(),
  qualityProfileId: z.number().int().positive(),
  coverageExternalIds: z.array(z.string().min(1)),
  capturedAt: z.iso.datetime(),
});
export type CanonicalAdoptionTarget = {
  mediaId: string;
  externalIds: Record<string, string>;
  checksum: string | null;
};
type AdoptionItem = {
  provenanceKey: string;
  observationHash: string;
  sourcePath: string;
  candidateMediaIds: string[];
  confidence: "exact" | "unknown" | "ambiguous";
  state: "protected" | "awaiting_owner_transfer";
  reasons: string[];
  owned: false;
  mayWrite: false;
};

function matchesIdentity(
  ids: Record<string, string>,
  target: CanonicalAdoptionTarget,
): boolean {
  const shared = Object.keys(ids).filter(
    (key) => target.externalIds[key] !== undefined,
  );
  return (
    shared.length > 0 &&
    shared.every((key) => target.externalIds[key] === ids[key])
  );
}
/** A report is evidence for explicit transfer, never authority to import or remove a path. */
export function createAdoptionReport(
  value: unknown,
  targets: CanonicalAdoptionTarget[],
): AdoptionItem[] {
  const assets = z.array(LegacyAssetSchema).parse(value);
  const provenance = new Set<string>();
  return assets.map((asset) => {
    const provenanceKey = `${asset.source}:${asset.sourceInstance}:file:${String(asset.sourceId)}`;
    if (provenance.has(provenanceKey))
      throw new Error("Duplicate source asset provenance");
    provenance.add(provenanceKey);
    const candidates = targets.filter((target) =>
      matchesIdentity(asset.externalIds, target),
    );
    const reasons: string[] = [];
    if (candidates.length === 0) reasons.push("identity_unresolved");
    if (candidates.length > 1) reasons.push("identity_ambiguous");
    if (asset.checksum === null) reasons.push("checksum_unverified");
    if (asset.coverageExternalIds.length === 0)
      reasons.push("file_coverage_unknown");
    if (
      candidates.some(
        (target) =>
          target.checksum !== null && target.checksum !== asset.checksum,
      )
    )
      reasons.push("existing_asset_conflict");
    if (assets.some((other) => other !== asset && other.path === asset.path))
      reasons.push("source_ownership_overlap");
    return {
      provenanceKey,
      observationHash: snapshotHash(z.json().parse(asset)),
      sourcePath: asset.path,
      candidateMediaIds: candidates.map((target) => target.mediaId),
      confidence:
        candidates.length === 1
          ? "exact"
          : candidates.length === 0
            ? "unknown"
            : "ambiguous",
      state: reasons.length === 0 ? "awaiting_owner_transfer" : "protected",
      reasons,
      owned: false,
      mayWrite: false,
    };
  });
}

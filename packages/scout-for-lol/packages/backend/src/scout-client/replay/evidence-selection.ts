import type { ReplayProvenance } from "./container.ts";

export type QualifiedReplayProvenance = ReplayProvenance & {
  readonly platformId: string;
};
export type ReplayEvidence = {
  readonly platformId: string;
  readonly authority: "archived" | "observed";
  readonly provenance: ReplayProvenance;
};

/** A bare game ID must resolve to exactly one platform; archives pin known facts. */
export function selectReplayEvidence(
  evidence: readonly ReplayEvidence[],
  platformId: string | null,
): QualifiedReplayProvenance | null {
  const candidates = evidence.filter(
    (entry) =>
      platformId === null || entry.platformId === platformId.toUpperCase(),
  );
  if (new Set(candidates.map((entry) => entry.platformId)).size !== 1)
    return null;
  const ordered = [...candidates].sort(
    (left, right) =>
      Number(right.authority === "archived") -
        Number(left.authority === "archived") ||
      left.provenance.localPuuid.localeCompare(right.provenance.localPuuid),
  );
  const primary = ordered[0];
  if (primary === undefined) return null;
  const conflict = ordered.some(
    (entry) =>
      entry.authority === primary.authority &&
      entry.provenance.localPuuid === primary.provenance.localPuuid &&
      JSON.stringify(entry.provenance) !== JSON.stringify(primary.provenance),
  );
  return conflict
    ? null
    : { ...primary.provenance, platformId: primary.platformId };
}

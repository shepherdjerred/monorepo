import type { ReplayProvenance } from "./container.ts";
import type { ReplayPresentationFacts } from "./provenance.ts";

export type QualifiedReplayProvenance = ReplayProvenance &
  ReplayPresentationFacts & {
    readonly platformId: string;
  };
export type ReplayEvidence = {
  readonly platformId: string;
  readonly authority: "archived" | "observed";
  readonly provenance: ReplayProvenance & Partial<ReplayPresentationFacts>;
};

function agreedFact<T>(values: readonly (T | null | undefined)[]): {
  conflict: boolean;
  value: T | null;
} {
  const known = values.filter((value) => value !== null && value !== undefined);
  return {
    conflict: new Set(known.map((value) => JSON.stringify(value))).size > 1,
    value: known[0] ?? null,
  };
}

function fingerprint(provenance: ReplayProvenance): string {
  return JSON.stringify({
    localPuuid: provenance.localPuuid,
    leaguePatch: provenance.leaguePatch,
    gameDurationSeconds: provenance.gameDurationSeconds,
    participant: provenance.participant,
  });
}

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
      fingerprint(entry.provenance) !== fingerprint(primary.provenance),
  );
  const peers = ordered.filter(
    (entry) =>
      entry.authority === primary.authority &&
      entry.provenance.localPuuid === primary.provenance.localPuuid,
  );
  const map = agreedFact(peers.map((entry) => entry.provenance.mapId));
  const mode = agreedFact(peers.map((entry) => entry.provenance.gameMode));
  const teams = agreedFact(peers.map((entry) => entry.provenance.teamSizes));
  return conflict || map.conflict || mode.conflict || teams.conflict
    ? null
    : {
        ...primary.provenance,
        mapId: map.value,
        gameMode: mode.value,
        teamSizes: teams.value,
        platformId: primary.platformId,
      };
}

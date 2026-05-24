import type { CompletedMatch } from "@scout-for-lol/data";

export type RankedDesign = "banner" | "square";

/**
 * FNV-1a 32-bit hash. Deterministic and dependency-free; we only need a
 * cheap stable hash of a few strings to pick a design.
 */
function fnv1a(input: string): number {
  let hash = 0x81_1c_9d_c5;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}

/**
 * Build a stable identifier for a match. CompletedMatch has no matchId field,
 * so derive one from the first tracked player's puuid + duration. Same match
 * always hashes the same way, so retries land on the same design and
 * snapshots stay stable.
 */
function stableMatchKey(match: CompletedMatch): string {
  const firstPlayer = match.players[0];
  const puuid = firstPlayer?.playerConfig.league.leagueAccount.puuid ?? "";
  return `${String(puuid)}|${match.durationInSeconds.toString()}`;
}

export function pickRankedDesign(match: CompletedMatch): RankedDesign {
  return fnv1a(stableMatchKey(match)) % 2 === 0 ? "banner" : "square";
}

/**
 * True for queues that should route to the new ranked designs (solo/duo + flex).
 * Everything else keeps the existing Report.
 */
export function isRankedQueue(queueType: CompletedMatch["queueType"]): boolean {
  return queueType === "solo" || queueType === "flex";
}

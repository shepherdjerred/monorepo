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
 * so derive one from the full set of tracked player puuids + duration. The
 * puuids are sorted so the key is independent of `match.players` ordering —
 * that array inherits the order of `getAccountsWithState()`'s Prisma
 * `findMany` (no `orderBy`), so `players[0]` is not stable across queries.
 * Sorting makes retries hash identically, so they land on the same design and
 * snapshots stay stable.
 */
function stableMatchKey(match: CompletedMatch): string {
  const puuids = match.players
    .map((player) => String(player.playerConfig.league.leagueAccount.puuid))
    .sort();
  return `${puuids.join(",")}|${match.durationInSeconds.toString()}`;
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

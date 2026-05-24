import type { CompletedMatch } from "@scout-for-lol/data";

export type Grade = "S+" | "S" | "A" | "B" | "C" | "D";

export function computeKda(kills: number, deaths: number, assists: number) {
  if (deaths === 0) {
    return kills + assists;
  }
  return (kills + assists) / deaths;
}

export function gradeFromKda(kda: number): Grade {
  if (kda >= 7) return "S+";
  if (kda >= 4.5) return "S";
  if (kda >= 3) return "A";
  if (kda >= 2) return "B";
  if (kda >= 1) return "C";
  return "D";
}

export function gradeForPlayer(
  player: CompletedMatch["players"][number],
): Grade {
  const { kills, deaths, assists } = player.champion;
  return gradeFromKda(computeKda(kills, deaths, assists));
}

/**
 * MVP = highest KDA among tracked players. Returns undefined when only one
 * tracked player exists (no comparison to make).
 */
export function findMvpIndex(
  players: CompletedMatch["players"],
): number | undefined {
  if (players.length < 2) return undefined;

  let bestIndex = 0;
  let bestKda = -Infinity;
  for (const [i, p] of players.entries()) {
    const kda = computeKda(
      p.champion.kills,
      p.champion.deaths,
      p.champion.assists,
    );
    if (kda > bestKda) {
      bestKda = kda;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Hero champion for the splash background = highest-KDA tracked player.
 * Falls back to first player.
 */
export function heroPlayer(
  players: CompletedMatch["players"],
): CompletedMatch["players"][number] {
  const mvp = findMvpIndex(players);
  const idx = mvp ?? 0;
  const picked = players[idx];
  if (!picked) {
    throw new Error("heroPlayer called with empty players array");
  }
  return picked;
}

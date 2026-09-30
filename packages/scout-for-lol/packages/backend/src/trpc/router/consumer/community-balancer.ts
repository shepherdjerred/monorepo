const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;

export type BalancerPlayer = {
  playerId: number;
  games: number;
  wins: number;
  strength: number;
  roles: Record<string, number>;
};

type Assignment = { playerId: number; role: string; fit: number };
type Team = { assignments: Assignment[]; fit: number; strength: number };

function bestTeam(players: BalancerPlayer[]): Team {
  const candidates: Team[] = [];
  const assign = (
    remaining: BalancerPlayer[],
    roleIndex: number,
    assignments: Assignment[],
    fit: number,
  ) => {
    if (roleIndex === ROLES.length) {
      candidates.push({
        assignments,
        fit,
        strength: players.reduce((sum, player) => sum + player.strength, 0) / 5,
      });
      return;
    }
    const role = ROLES[roleIndex];
    if (role === undefined) throw new Error("Missing canonical role");
    for (const player of remaining) {
      const share =
        player.games > 0 ? (player.roles[role] ?? 0) / player.games : 0;
      assign(
        remaining.filter((candidate) => candidate.playerId !== player.playerId),
        roleIndex + 1,
        [...assignments, { playerId: player.playerId, role, fit: share }],
        fit + share,
      );
    }
  };
  assign(players, 0, [], 0);
  const first = candidates[0];
  if (first === undefined)
    throw new Error("Five-player role assignment failed");
  return candidates.reduce(
    (best, candidate) => (candidate.fit > best.fit ? candidate : best),
    first,
  );
}

function betterCandidate(
  candidate: { fit: number; gap: number },
  chosen: { fit: number; gap: number },
  priority: "roles" | "strength",
): boolean {
  return priority === "roles"
    ? candidate.fit > chosen.fit ||
        (candidate.fit === chosen.fit && candidate.gap < chosen.gap)
    : candidate.gap < chosen.gap ||
        (candidate.gap === chosen.gap && candidate.fit > chosen.fit);
}

/** Exhaustive 5/5 split, with each team's 5! role assignments optimized. */
export function balanceGuildTeams(
  players: BalancerPlayer[],
  priority: "roles" | "strength",
) {
  if (
    players.length !== 10 ||
    new Set(players.map((player) => player.playerId)).size !== 10
  ) {
    throw new Error("Balancer requires ten unique players");
  }
  const sorted = players.toSorted(
    (left, right) => left.playerId - right.playerId,
  );
  const teams = new Map<number, Team>();
  for (let mask = 0; mask < 1024; mask++) {
    if (mask.toString(2).replaceAll("0", "").length !== 5) continue;
    const members = sorted.filter((_, index) => (mask & (1 << index)) !== 0);
    teams.set(mask, bestTeam(members));
  }
  let chosen: { first: Team; second: Team; fit: number; gap: number } | null =
    null;
  for (const [mask, first] of teams) {
    if ((mask & 1) === 0) continue;
    const second = teams.get(1023 ^ mask);
    if (second === undefined) throw new Error("Complement team missing");
    const fit = first.fit + second.fit;
    const gap = Math.abs(first.strength - second.strength);
    if (chosen === null || betterCandidate({ fit, gap }, chosen, priority)) {
      chosen = { first, second, fit, gap };
    }
  }
  if (chosen === null) throw new Error("No balanced split found");
  return {
    teams: [chosen.first, chosen.second],
    roleFit: chosen.fit,
    formGap: chosen.gap,
    lowDataPlayerIds: sorted
      .filter((player) => player.games < 3)
      .map((player) => player.playerId),
  };
}

import type { ReportGroupSize } from "@scout-for-lol/data";
import type { AggregateRow } from "#src/reports/query-aggregates.ts";

/**
 * Teammate-group aggregation for the DuckDB lake path (execute.ts).
 *
 * A "group unit" is the set of tracked players who shared a team in one
 * match: (matchId, teamId) for standard queues, plus playerSubteamId for
 * Arena, where teamId 100/200 is a whole side spanning several unrelated
 * 2-3 player subteams. All size-k member combinations of each unit are
 * accumulated into one row per distinct player tuple.
 *
 * Group semantics generalize the old pair engine: a group wins iff every
 * member won, surrenders iff any member surrendered, counters sum across
 * members, and game duration counts once per group-game.
 */

export type GroupFactRow = {
  playerId: number;
  playerAlias: string;
  matchId: string;
  teamId: number;
  /** Arena subteam (1-8); null for every non-Arena queue. */
  playerSubteamId: number | null;
  win: boolean;
  surrendered: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  damageToChampions: number;
  goldEarned: number;
  visionScore: number;
  damageTaken: number;
  totalDamageDealt: number;
  wardsPlaced: number;
  multikills: number;
  gameDurationSeconds: number;
  timePlayedSeconds: number;
  earlySurrendered: boolean;
  laneMinions: number;
  neutralMinions: number;
  goldSpent: number;
  damageMitigated: number;
  damageToObjectives: number;
  damageToTurrets: number;
  healing: number;
  teammateHealing: number;
  wardsKilled: number;
  controlWardsBought: number;
  detectorWardsPlaced: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  largestMultikill: number;
  killingSprees: number;
  firstBlood: boolean;
  championLevel: number;
  championExperience: number;
  timeDeadSeconds: number;
  longestLifeSeconds: number;
  ccTimeSeconds: number;
  turretKills: number;
  inhibitorKills: number;
  dragonKills: number;
  baronKills: number;
  placement: number | null;
};

/**
 * Aggregate raw per-player facts into teammate-group rows. `groupSize`
 * selects one size (2-5) or "all" for every size each unit's roster
 * supports. Rows are unsorted — callers feed them through sortedAggregates.
 */
export function aggregateGroupFacts(
  facts: GroupFactRow[],
  groupSize: ReportGroupSize,
): AggregateRow[] {
  // Dedupe by player within each unit (a player with two tracked accounts in
  // one match keeps the last-processed fact, matching the legacy engine; the
  // lake path already dedupes in SQL so this is a no-op there).
  const byUnit = new Map<string, Map<number, GroupFactRow>>();
  for (const fact of facts) {
    const unitKey = `${fact.matchId}:${fact.teamId.toString()}:${fact.playerSubteamId?.toString() ?? "-"}`;
    const unit = byUnit.get(unitKey) ?? new Map<number, GroupFactRow>();
    unit.set(fact.playerId, fact);
    byUnit.set(unitKey, unit);
  }

  const byGroup = new Map<string, AggregateRow>();
  for (const unit of byUnit.values()) {
    const members = [...unit.values()].toSorted(
      (left, right) => left.playerId - right.playerId,
    );
    const sizes =
      groupSize === "all" ? rangeInclusive(2, members.length) : [groupSize];
    for (const size of sizes) {
      forEachCombination(members, size, (group) => {
        addGroupRow(byGroup, group);
      });
    }
  }

  return [...byGroup.values()];
}

function rangeInclusive(from: number, to: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to; value++) {
    out.push(value);
  }
  return out;
}

// Iterative k-subset enumeration over the (playerId-sorted) member array, so
// every emitted combination is already in canonical order.
function forEachCombination(
  members: GroupFactRow[],
  size: number,
  visit: (group: GroupFactRow[]) => void,
): void {
  if (size < 2 || size > members.length) {
    return;
  }
  const indices = rangeInclusive(0, size - 1);
  for (;;) {
    visit(
      indices.map((index) => members[index]).filter((m) => m !== undefined),
    );
    // Advance to the next combination (rightmost index that can move).
    let cursor = size - 1;
    while (cursor >= 0) {
      const current = indices[cursor];
      if (current !== undefined && current < members.length - (size - cursor)) {
        break;
      }
      cursor--;
    }
    if (cursor < 0) {
      return;
    }
    const bumped = (indices[cursor] ?? 0) + 1;
    for (let fill = cursor; fill < size; fill++) {
      indices[fill] = bumped + (fill - cursor);
    }
  }
}

function addGroupRow(
  byGroup: Map<string, AggregateRow>,
  group: GroupFactRow[],
): void {
  const key = group.map((member) => member.playerId.toString()).join("|");
  const current = byGroup.get(key) ?? emptyGroupAggregate(group);
  current.games++;
  if (group.every((member) => member.win)) {
    current.wins++;
  }
  if (group.some((member) => member.surrendered)) {
    current.surrenders++;
  }
  for (const member of group) {
    current.participantRows++;
    current.kills += member.kills;
    current.deaths += member.deaths;
    current.assists += member.assists;
    current.creepScore += member.creepScore;
    current.damageToChampions += member.damageToChampions;
    current.goldEarned += member.goldEarned;
    current.visionScore += member.visionScore;
    current.damageTaken += member.damageTaken;
    current.totalDamageDealt += member.totalDamageDealt;
    current.wardsPlaced += member.wardsPlaced;
    current.multikills += member.multikills;
    current.timePlayedSeconds += member.timePlayedSeconds;
    if (member.earlySurrendered) current.earlySurrenders++;
    current.laneMinions += member.laneMinions;
    current.neutralMinions += member.neutralMinions;
    current.goldSpent += member.goldSpent;
    current.damageMitigated += member.damageMitigated;
    current.damageToObjectives += member.damageToObjectives;
    current.damageToTurrets += member.damageToTurrets;
    current.healing += member.healing;
    current.teammateHealing += member.teammateHealing;
    current.wardsKilled += member.wardsKilled;
    current.controlWardsBought += member.controlWardsBought;
    current.detectorWardsPlaced += member.detectorWardsPlaced;
    current.doubleKills += member.doubleKills;
    current.tripleKills += member.tripleKills;
    current.quadraKills += member.quadraKills;
    current.pentaKills += member.pentaKills;
    current.largestMultikill = Math.max(
      current.largestMultikill,
      member.largestMultikill,
    );
    current.killingSprees += member.killingSprees;
    if (member.firstBlood) current.firstBloods++;
    current.championLevelTotal += member.championLevel;
    current.championExperienceTotal += member.championExperience;
    current.timeDeadSeconds += member.timeDeadSeconds;
    current.longestLifeSeconds = Math.max(
      current.longestLifeSeconds,
      member.longestLifeSeconds,
    );
    current.ccTimeSeconds += member.ccTimeSeconds;
    current.turretKills += member.turretKills;
    current.inhibitorKills += member.inhibitorKills;
    current.dragonKills += member.dragonKills;
    current.baronKills += member.baronKills;
    if (member.placement !== null) {
      current.arenaRows++;
      current.placementSum += member.placement;
      if (member.placement <= 2) current.topTwoPlacements++;
      if (member.placement === 1) current.firstPlaceFinishes++;
    }
  }
  // One duration per group-game so avg_game_duration is a true per-game
  // average (mirrors the pair engine's p1-only duration).
  current.durationSeconds += group[0]?.gameDurationSeconds ?? 0;
  byGroup.set(key, current);
}

function emptyGroupAggregate(group: GroupFactRow[]): AggregateRow {
  return {
    label: group.map((member) => member.playerAlias).join(" + "),
    discordId: null,
    games: 0,
    wins: 0,
    surrenders: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
    damageToChampions: 0,
    goldEarned: 0,
    visionScore: 0,
    damageTaken: 0,
    totalDamageDealt: 0,
    wardsPlaced: 0,
    multikills: 0,
    durationSeconds: 0,
    timePlayedSeconds: 0,
    participantRows: 0,
    earlySurrenders: 0,
    laneMinions: 0,
    neutralMinions: 0,
    goldSpent: 0,
    damageMitigated: 0,
    damageToObjectives: 0,
    damageToTurrets: 0,
    healing: 0,
    teammateHealing: 0,
    wardsKilled: 0,
    controlWardsBought: 0,
    detectorWardsPlaced: 0,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    largestMultikill: 0,
    killingSprees: 0,
    firstBloods: 0,
    championLevelTotal: 0,
    championExperienceTotal: 0,
    timeDeadSeconds: 0,
    longestLifeSeconds: 0,
    ccTimeSeconds: 0,
    turretKills: 0,
    inhibitorKills: 0,
    dragonKills: 0,
    baronKills: 0,
    arenaRows: 0,
    placementSum: 0,
    topTwoPlacements: 0,
    firstPlaceFinishes: 0,
  };
}

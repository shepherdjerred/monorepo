import type { Database } from "bun:sqlite";
import type {
  TownSummarySnapshot,
  WeaponStat,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import type {
  GameplayOverviewResponse,
  MobCombatRow,
  PvpLeaderRow,
  PvpOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import { loadServerState } from "./player-activity.ts";
import { toCombatFeedRow, type RawCombatRow } from "./queries-players.ts";
import {
  parseNumberRecordJson,
  parseTownsJson,
  type PlayerGameplayRow,
} from "./schema.ts";
import { computeKdr, safePercent } from "./time.ts";

export function queryPvpOverview(
  db: Database,
  nowIso: string,
): PvpOverviewResponse {
  const countsRow = db
    .query<
      {
        pvp_kills: number;
        mob_kills: number;
        player_deaths: number;
      },
      []
    >(
      `SELECT
         SUM(CASE WHEN combat_kind = 'pvp' THEN 1 ELSE 0 END) AS pvp_kills,
         SUM(CASE WHEN combat_kind = 'pve_kill' THEN 1 ELSE 0 END) AS mob_kills,
         SUM(CASE WHEN combat_kind IN ('pvp', 'pve_death', 'env_death') AND victim_uuid IS NOT NULL THEN 1 ELSE 0 END) AS player_deaths
       FROM combat_events`,
    )
    .get();

  const combatantsRow = db
    .query<{ c: number }, []>(
      `SELECT COUNT(*) AS c FROM (
         SELECT killer_uuid AS uuid FROM combat_events WHERE killer_uuid IS NOT NULL
         UNION
         SELECT victim_uuid AS uuid FROM combat_events WHERE victim_uuid IS NOT NULL
       )`,
    )
    .get();

  const weaponRows = db
    .query<{ weapon: string; kills: number }, []>(
      `SELECT weapon, COUNT(*) AS kills
       FROM combat_events
       WHERE combat_kind = 'pvp'
       GROUP BY weapon
       ORDER BY kills DESC, weapon ASC
       LIMIT 15`,
    )
    .all();

  const totalPvpWeaponKills = weaponRows.reduce((acc, r) => acc + r.kills, 0);
  const topWeapons: WeaponStat[] = weaponRows.map((r) => ({
    weapon: r.weapon,
    kills: r.kills,
    sharePercent: safePercent(r.kills, totalPvpWeaponKills),
  }));

  const mobRows = db
    .query<
      {
        mob_type: string;
        killed_by_players: number;
        killed_players: number;
      },
      []
    >(
      `SELECT mob_type,
              SUM(CASE WHEN combat_kind = 'pve_kill' THEN 1 ELSE 0 END) AS killed_by_players,
              SUM(CASE WHEN combat_kind = 'pve_death' THEN 1 ELSE 0 END) AS killed_players
       FROM combat_events
       WHERE mob_type IS NOT NULL
       GROUP BY mob_type
       ORDER BY (killed_players * 5 + killed_by_players) DESC, mob_type ASC
       LIMIT 20`,
    )
    .all();

  const mobBreakdown: MobCombatRow[] = mobRows.map((r) => ({
    mobType: r.mob_type,
    killedByPlayers: r.killed_by_players,
    killedPlayers: r.killed_players,
  }));

  const deadliestMobRow = db
    .query<{ mob_type: string }, []>(
      `SELECT mob_type
       FROM combat_events
       WHERE combat_kind = 'pve_death' AND mob_type IS NOT NULL
       GROUP BY mob_type
       ORDER BY COUNT(*) DESC, mob_type ASC
       LIMIT 1`,
    )
    .get();

  const topWeaponByKillerRows = db
    .query<{ killer_uuid: string; weapon: string; kills: number }, []>(
      `SELECT killer_uuid, weapon, COUNT(*) AS kills
       FROM combat_events
       WHERE killer_uuid IS NOT NULL AND combat_kind = 'pvp'
       GROUP BY killer_uuid, weapon
       ORDER BY kills DESC, weapon ASC`,
    )
    .all();
  const topWeaponByPlayer = new Map<string, string>();
  for (const row of topWeaponByKillerRows) {
    if (!topWeaponByPlayer.has(row.killer_uuid)) {
      topWeaponByPlayer.set(row.killer_uuid, row.weapon);
    }
  }

  const warriorRows = db
    .query<
      {
        uuid: string;
        name: string;
        pvp_kills: number;
        pvp_deaths: number;
        mob_kills: number;
      },
      []
    >(
      `SELECT uuid, name, pvp_kills, pvp_deaths, mob_kills
       FROM players
       WHERE pvp_kills > 0 OR pvp_deaths > 0 OR mob_kills > 0
       ORDER BY pvp_kills DESC, mob_kills DESC, name ASC
       LIMIT 25`,
    )
    .all();

  const topWarriors: PvpLeaderRow[] = warriorRows.map((r) => ({
    uuid: r.uuid,
    name: r.name,
    kills: r.pvp_kills,
    deaths: r.pvp_deaths,
    kdr: computeKdr(r.pvp_kills, r.pvp_deaths),
    topWeapon: topWeaponByPlayer.get(r.uuid) ?? null,
    mobKills: r.mob_kills,
  }));

  const recentRows = db
    .query<RawCombatRow, []>(
      `SELECT event_id, occurred_at, combat_kind, killer_uuid, killer_name,
              victim_uuid, victim_name, mob_type, weapon, world
       FROM combat_events
       ORDER BY occurred_at DESC
       LIMIT 40`,
    )
    .all();

  return {
    generatedAt: nowIso,
    kpis: {
      totalPvpKills: countsRow?.pvp_kills ?? 0,
      totalMobKills: countsRow?.mob_kills ?? 0,
      totalPlayerDeaths: countsRow?.player_deaths ?? 0,
      uniqueCombatants: combatantsRow?.c ?? 0,
      deadliestWeapon: topWeapons[0]?.weapon ?? null,
      deadliestMob:
        deadliestMobRow?.mob_type ?? mobBreakdown[0]?.mobType ?? null,
    },
    topWarriors,
    topWeapons,
    mobBreakdown,
    recentKills: recentRows.map((row) => toCombatFeedRow(row)),
  };
}

export function queryGameplayOverview(
  db: Database,
  nowIso: string,
): GameplayOverviewResponse {
  const { row: state } = loadServerState(db);
  const snapshotTowns = parseTownsJson(state.towns_json);

  const gameplayRows = db
    .query<PlayerGameplayRow, []>("SELECT * FROM player_gameplay")
    .all();

  const economyTop = [...gameplayRows]
    .sort(
      (a, b) =>
        b.crystals - a.crystals || a.player_name.localeCompare(b.player_name),
    )
    .slice(0, 20)
    .map((r) => ({
      uuid: r.player_uuid,
      name: r.player_name,
      crystals: r.crystals,
      townName: r.town_name,
    }));

  let towns = [...snapshotTowns].sort(
    (a, b) =>
      b.members - a.members ||
      b.claims - a.claims ||
      a.name.localeCompare(b.name),
  );
  if (towns.length === 0) {
    const derived = new Map<string, { members: number; claims: number }>();
    for (const r of gameplayRows) {
      if (r.town_name === null || r.town_kind === "camp") {
        continue;
      }
      const existing = derived.get(r.town_name) ?? { members: 0, claims: 0 };
      existing.members += 1;
      existing.claims = Math.max(existing.claims, r.town_claims);
      derived.set(r.town_name, existing);
    }
    towns = [...derived.entries()]
      .map(([name, info]): TownSummarySnapshot => ({
        name,
        members: info.members,
        claims: info.claims,
        kind: "player",
      }))
      .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
  }

  const skillsTop = [...gameplayRows]
    .sort(
      (a, b) =>
        b.power_level - a.power_level ||
        b.top_skill_level - a.top_skill_level ||
        a.player_name.localeCompare(b.player_name),
    )
    .slice(0, 20)
    .map((r) => ({
      uuid: r.player_uuid,
      name: r.player_name,
      powerLevel: r.power_level,
      topSkill: r.top_skill,
      topSkillLevel: r.top_skill_level,
    }));

  const rwfTop = gameplayRows
    .filter((r) => r.rwf_matches > 0)
    .sort(
      (a, b) =>
        b.rwf_wins - a.rwf_wins ||
        b.rwf_kills - a.rwf_kills ||
        b.rwf_matches - a.rwf_matches ||
        a.player_name.localeCompare(b.player_name),
    )
    .slice(0, 20)
    .map((r) => ({
      uuid: r.player_uuid,
      name: r.player_name,
      matches: r.rwf_matches,
      wins: r.rwf_wins,
      losses: r.rwf_losses,
      kills: r.rwf_kills,
      deaths: r.rwf_deaths,
    }));

  const arenaEntries: {
    arena: string;
    uuid: string;
    name: string;
    bestWave: number;
  }[] = [];
  for (const r of gameplayRows) {
    const waves = parseNumberRecordJson(r.arena_waves_json);
    for (const [arena, bestWave] of Object.entries(waves)) {
      if (bestWave > 0) {
        arenaEntries.push({
          arena,
          uuid: r.player_uuid,
          name: r.player_name,
          bestWave,
        });
      }
    }
  }
  arenaEntries.sort(
    (a, b) =>
      b.bestWave - a.bestWave ||
      a.arena.localeCompare(b.arena) ||
      a.name.localeCompare(b.name),
  );

  const questsTop = gameplayRows
    .filter((r) => r.quests_completed > 0)
    .sort(
      (a, b) =>
        b.quests_completed - a.quests_completed ||
        b.power_level - a.power_level ||
        a.player_name.localeCompare(b.player_name),
    )
    .slice(0, 20)
    .map((r) => ({
      uuid: r.player_uuid,
      name: r.player_name,
      questsCompleted: r.quests_completed,
      powerLevel: r.power_level,
    }));

  return {
    generatedAt: nowIso,
    economyTop,
    towns,
    skillsTop,
    rwfTop,
    arenaTop: arenaEntries.slice(0, 25),
    questsTop,
  };
}

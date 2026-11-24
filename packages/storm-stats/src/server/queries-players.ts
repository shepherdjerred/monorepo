import type { Database } from "bun:sqlite";
import {
  CombatKindSchema,
  WorldBucketSchema,
  type ActivityGroup,
  type CombatFeedRow,
  type Platform,
  type PlayerDirectoryRow,
  type PlayerSortField,
  type PlayersDirectoryResponse,
  type ViewerRole,
  type WeaponStat,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import type {
  PlayerCalendarDay,
  PlayerCombatSummary,
  PlayerGameplayCard,
  PlayerProfileResponse,
} from "@shepherdjerred/storm-stats/shared/player-contract.ts";
import {
  buildPlayerDirectoryRow,
  loadAllPlayerActivityScores,
  loadPrimaryWorldAndModeByPlayer,
  loadServerState,
  toSessionSummaries,
} from "./player-activity.ts";
import { buildModeShares, buildWorldShares } from "./queries-shares.ts";
import {
  parseNumberRecordJson,
  type PlayerGameplayRow,
  type PlayerRow,
  type SessionRow,
} from "./schema.ts";
import {
  buildCalendarDaySeries,
  computeKdr,
  msToHours,
  safePercent,
  toPacificDay,
} from "./time.ts";

export type PlayersQueryOptions = {
  readonly search?: string;
  readonly sort?: PlayerSortField;
  readonly order?: "asc" | "desc";
  readonly activityGroup?: ActivityGroup;
  readonly platform?: Platform;
  readonly onlineOnly?: boolean;
  readonly town?: string;
  readonly page?: number;
  readonly pageSize?: number;
};

export function findPlayerRowByIdOrName(
  db: Database,
  idOrName: string,
): PlayerRow | null {
  const normalized = idOrName.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  return db
    .query<PlayerRow, [string, string]>(
      `SELECT * FROM players
       WHERE lower(uuid) = ? OR name_lower = ?
       ORDER BY last_seen_at DESC
       LIMIT 1`,
    )
    .get(normalized, normalized);
}

export function loadGameplayMap(
  db: Database,
): ReadonlyMap<string, PlayerGameplayRow> {
  const rows = db
    .query<PlayerGameplayRow, []>("SELECT * FROM player_gameplay")
    .all();
  return new Map(rows.map((r) => [r.player_uuid, r]));
}

export function compareDirectoryRows(
  left: PlayerDirectoryRow,
  right: PlayerDirectoryRow,
  sort: PlayerSortField,
  order: "asc" | "desc",
): number {
  let diff = 0;
  switch (sort) {
    case "activePlaytime":
      diff = left.activeMs - right.activeMs;
      break;
    case "connectedPlaytime":
      diff = left.connectedMs - right.connectedMs;
      break;
    case "sessions":
      diff = left.sessionsCount - right.sessionsCount;
      break;
    case "lastSeen":
      diff = left.lastSeenAt.localeCompare(right.lastSeenAt);
      break;
    case "firstSeen":
      diff = left.firstSeenAt.localeCompare(right.firstSeenAt);
      break;
    case "activityIndex":
      diff = left.activityIndex - right.activityIndex;
      break;
    case "coins":
      diff = left.coins - right.coins;
      break;
    case "powerLevel":
      diff = left.powerLevel - right.powerLevel;
      break;
    case "pvpKills":
      diff = left.pvpKills - right.pvpKills;
      break;
    case "name":
      diff = left.name.localeCompare(right.name, "en", {
        sensitivity: "base",
      });
      break;
  }
  if (diff === 0) {
    return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  }
  return order === "asc" ? diff : -diff;
}

function matchesPlayersFilter(
  row: PlayerDirectoryRow,
  options: PlayersQueryOptions,
): boolean {
  if (
    options.activityGroup !== undefined &&
    row.activityGroup !== options.activityGroup
  ) {
    return false;
  }
  if (options.platform !== undefined && row.platform !== options.platform) {
    return false;
  }
  if (options.onlineOnly === true && !row.online) {
    return false;
  }
  if (
    options.town !== undefined &&
    options.town.length > 0 &&
    (row.townName ?? "").toLowerCase() !== options.town.toLowerCase()
  ) {
    return false;
  }
  const q = options.search?.trim().toLowerCase();
  if (q !== undefined && q.length > 0) {
    const inName = row.name.toLowerCase().includes(q);
    const inNick = (row.nickname ?? "").toLowerCase().includes(q);
    const inUuid = row.uuid.toLowerCase().includes(q);
    const inTown = (row.townName ?? "").toLowerCase().includes(q);
    if (!inName && !inNick && !inUuid && !inTown) {
      return false;
    }
  }
  return true;
}

export function loadAllDirectoryRows(
  db: Database,
  viewer: ViewerRole,
  nowIso: string,
): PlayerDirectoryRow[] {
  const { onlineByUuid } = loadServerState(db, nowIso);
  const activityByUuid = loadAllPlayerActivityScores(db, nowIso);
  const { primaryWorld, primaryMode } = loadPrimaryWorldAndModeByPlayer(db);
  const gameplayByUuid = loadGameplayMap(db);
  const playerRows = db.query<PlayerRow, []>("SELECT * FROM players").all();

  const ctx = {
    onlineByUuid,
    activityByUuid,
    primaryWorldByUuid: primaryWorld,
    primaryModeByUuid: primaryMode,
    gameplayByUuid,
    viewer,
  };
  return playerRows.map((row) => buildPlayerDirectoryRow(row, ctx));
}

export function queryPlayersDirectory(
  db: Database,
  options: PlayersQueryOptions,
  viewer: ViewerRole,
  nowIso: string,
): PlayersDirectoryResponse {
  const sort = options.sort ?? "activePlaytime";
  const order = options.order ?? (sort === "name" ? "asc" : "desc");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

  const allRows = loadAllDirectoryRows(db, viewer, nowIso);
  const filtered = allRows.filter((row) => matchesPlayersFilter(row, options));
  filtered.sort((a, b) => compareDirectoryRows(a, b, sort, order));

  const offset = (page - 1) * pageSize;
  return {
    items: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export type RawCombatRow = {
  readonly event_id: string;
  readonly occurred_at: string;
  readonly combat_kind: string;
  readonly killer_uuid: string | null;
  readonly killer_name: string | null;
  readonly victim_uuid: string | null;
  readonly victim_name: string | null;
  readonly mob_type: string | null;
  readonly weapon: string;
  readonly world: string;
};

export function toCombatFeedRow(row: RawCombatRow): CombatFeedRow {
  const kindParsed = CombatKindSchema.safeParse(row.combat_kind);
  const worldParsed = WorldBucketSchema.safeParse(row.world);
  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    combatKind: kindParsed.success ? kindParsed.data : "pvp",
    killerUuid: row.killer_uuid,
    killerName: row.killer_name,
    victimUuid: row.victim_uuid,
    victimName: row.victim_name,
    mobType: row.mob_type,
    weapon: row.weapon,
    world: worldParsed.success ? worldParsed.data : "world",
  };
}

function buildPlayerCalendar365d(
  db: Database,
  playerUuid: string,
  todayPacific: string,
): PlayerCalendarDay[] {
  const days = buildCalendarDaySeries(todayPacific, 365);
  const startDay = days[0] ?? todayPacific;

  const byDay = new Map<
    string,
    { connectedMs: number; activeMs: number; sessions: Set<string> }
  >();

  const intervals = db
    .query<
      {
        pacific_day: string;
        session_id: string;
        connected_ms: number;
        active_ms: number;
      },
      [string, string, string]
    >(
      `SELECT pacific_day, session_id, connected_ms, active_ms
       FROM session_intervals
       WHERE player_uuid = ? AND pacific_day >= ? AND pacific_day <= ?`,
    )
    .all(playerUuid, startDay, todayPacific);

  for (const row of intervals) {
    let entry = byDay.get(row.pacific_day);
    if (entry === undefined) {
      entry = { connectedMs: 0, activeMs: 0, sessions: new Set<string>() };
      byDay.set(row.pacific_day, entry);
    }
    entry.connectedMs += row.connected_ms;
    entry.activeMs += row.active_ms;
    entry.sessions.add(row.session_id);
  }

  const remainders = db
    .query<
      {
        session_id: string;
        ref_at: string;
        rem_c: number;
        rem_a: number;
      },
      [string]
    >(
      `SELECT session_id,
              COALESCE(ended_at, started_at) AS ref_at,
              MAX(0, connected_ms - interval_connected_ms) AS rem_c,
              MAX(0, active_ms - interval_active_ms) AS rem_a
       FROM sessions
       WHERE player_uuid = ?
         AND (connected_ms > interval_connected_ms OR interval_connected_ms = 0)`,
    )
    .all(playerUuid);

  for (const s of remainders) {
    const day = toPacificDay(s.ref_at);
    if (day < startDay || day > todayPacific) {
      continue;
    }
    let entry = byDay.get(day);
    if (entry === undefined) {
      entry = { connectedMs: 0, activeMs: 0, sessions: new Set<string>() };
      byDay.set(day, entry);
    }
    entry.connectedMs += s.rem_c;
    entry.activeMs += s.rem_a;
    entry.sessions.add(s.session_id);
  }

  return days.map((day) => {
    const entry = byDay.get(day);
    return {
      day,
      connectedHours: msToHours(entry?.connectedMs ?? 0),
      activeHours: msToHours(entry?.activeMs ?? 0),
      sessions: entry?.sessions.size ?? 0,
    };
  });
}

function buildPlayerCombatSummary(
  db: Database,
  player: PlayerRow,
): PlayerCombatSummary {
  const weaponRows = db
    .query<{ weapon: string; kills: number }, [string]>(
      `SELECT weapon, COUNT(*) AS kills
       FROM combat_events
       WHERE killer_uuid = ? AND combat_kind IN ('pvp', 'pve_kill')
       GROUP BY weapon
       ORDER BY kills DESC, weapon ASC
       LIMIT 8`,
    )
    .all(player.uuid);

  const totalWeaponKills = weaponRows.reduce((acc, r) => acc + r.kills, 0);
  const favoriteWeapons: WeaponStat[] = weaponRows.map((r) => ({
    weapon: r.weapon,
    kills: r.kills,
    sharePercent: safePercent(r.kills, totalWeaponKills),
  }));

  const recentRows = db
    .query<RawCombatRow, [string, string]>(
      `SELECT event_id, occurred_at, combat_kind, killer_uuid, killer_name,
              victim_uuid, victim_name, mob_type, weapon, world
       FROM combat_events
       WHERE killer_uuid = ? OR victim_uuid = ?
       ORDER BY occurred_at DESC
       LIMIT 25`,
    )
    .all(player.uuid, player.uuid);

  return {
    pvpKills: player.pvp_kills,
    pvpDeaths: player.pvp_deaths,
    kdr: computeKdr(player.pvp_kills, player.pvp_deaths),
    mobKills: player.mob_kills,
    mobDeaths: player.mob_deaths,
    envDeaths: player.env_deaths,
    favoriteWeapons,
    recentCombat: recentRows.map((row) => toCombatFeedRow(row)),
  };
}

function toGameplayCard(
  row: PlayerGameplayRow | null,
): PlayerGameplayCard | null {
  if (row === null) {
    return null;
  }
  return {
    capturedAt: row.captured_at,
    coins: row.coins,
    townName: row.town_name,
    townRole: row.town_role,
    townClaims: row.town_claims,
    powerLevel: row.power_level,
    topSkill: row.top_skill,
    topSkillLevel: row.top_skill_level,
    skills: parseNumberRecordJson(row.skills_json),
    tracks: parseNumberRecordJson(row.tracks_json),
    questsCompleted: row.quests_completed,
    arenaBestWaves: parseNumberRecordJson(row.arena_waves_json),
    rwfMatches: row.rwf_matches,
    rwfWins: row.rwf_wins,
    rwfLosses: row.rwf_losses,
    rwfKills: row.rwf_kills,
    rwfDeaths: row.rwf_deaths,
  };
}

export function queryPlayerProfile(
  db: Database,
  idOrName: string,
  nowIso: string,
): PlayerProfileResponse | null {
  const player = findPlayerRowByIdOrName(db, idOrName);
  if (player === null) {
    return null;
  }

  const { onlineByUuid } = loadServerState(db, nowIso);
  const onlineEntry = onlineByUuid.get(player.uuid);
  const activityByUuid = loadAllPlayerActivityScores(db, nowIso);
  const score = activityByUuid.get(player.uuid) ?? {
    activityIndex: 0,
    activityGroup: "inactive" as const,
  };

  const sessionRows = db
    .query<SessionRow, [string]>(
      `SELECT * FROM sessions
       WHERE player_uuid = ?
       ORDER BY ongoing DESC, COALESCE(ended_at, started_at) DESC, started_at DESC
       LIMIT 25`,
    )
    .all(player.uuid);

  const gameplayRow = db
    .query<PlayerGameplayRow, [string]>(
      "SELECT * FROM player_gameplay WHERE player_uuid = ?",
    )
    .get(player.uuid);

  const pingAvgMs =
    player.ping_count > 0
      ? Math.round(player.ping_sum_ms / player.ping_count)
      : null;
  const meanSessionMs =
    player.sessions_count > 0
      ? Math.round(player.connected_ms / player.sessions_count)
      : 0;

  return {
    generatedAt: nowIso,
    player: {
      uuid: player.uuid,
      name: player.name,
      nickname: player.nickname,
      online: onlineEntry !== undefined,
      currentWorld: onlineEntry?.world ?? null,
      currentMode: onlineEntry?.mode ?? null,
      afk: onlineEntry?.afk ?? false,
      firstSeenAt: player.first_seen_at,
      lastSeenAt: player.last_seen_at,
      activityIndex: score.activityIndex,
      activityGroup: score.activityGroup,
      primaryGroup: player.primary_group,
      platform: player.platform,
      clientVersion: player.client_version,
      connectedMs: player.connected_ms,
      activeMs: player.active_ms,
      afkMs: Math.max(0, player.connected_ms - player.active_ms),
      sessionsCount: player.sessions_count,
      longestSessionMs: player.longest_session_ms,
      meanSessionMs,
      pingMinMs: player.ping_min_ms,
      pingAvgMs,
      pingMaxMs: player.ping_max_ms,
    },
    worldBreakdown: buildWorldShares(db, player.uuid),
    modeBreakdown: buildModeShares(db, player.uuid),
    calendar365d: buildPlayerCalendar365d(
      db,
      player.uuid,
      toPacificDay(nowIso),
    ),
    recentSessions: toSessionSummaries(db, sessionRows),
    combat: buildPlayerCombatSummary(db, player),
    gameplay: toGameplayCard(gameplayRow),
  };
}

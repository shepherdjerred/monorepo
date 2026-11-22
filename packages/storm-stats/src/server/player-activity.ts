import type { Database } from "bun:sqlite";
import {
  GameModeSchema,
  WorldBucketSchema,
  type ActivityGroup,
  type GameMode,
  type OnlinePlayerSummary,
  type PlayerDirectoryRow,
  type PlayerbaseBreakdown,
  type SessionSummary,
  type ViewerRole,
  type WorldBucket,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  parseOnlinePlayersJson,
  type PlayerGameplayRow,
  type PlayerRow,
  type ServerStateRow,
  type SessionRow,
} from "./schema.ts";
import { DAY_MS, MINUTE_MS, computeActivityIndex } from "./time.ts";

export const SERVER_SNAPSHOT_STALE_MS = 5 * MINUTE_MS;

export type ThreeWeekWindows = {
  readonly w0: number;
  readonly w1: number;
  readonly w2: number;
};

export type PlayerActivityScore = {
  readonly activityIndex: number;
  readonly activityGroup: ActivityGroup;
};

function isServerSnapshotFresh(
  capturedAt: string | null,
  nowIso: string | undefined,
): boolean {
  if (capturedAt === null) {
    return false;
  }
  if (nowIso === undefined) {
    return true;
  }
  const capturedMs = Date.parse(capturedAt);
  const nowMs = Date.parse(nowIso);
  return (
    !Number.isNaN(capturedMs) &&
    !Number.isNaN(nowMs) &&
    nowMs - capturedMs <= SERVER_SNAPSHOT_STALE_MS
  );
}

export function loadServerState(
  db: Database,
  nowIso?: string,
): {
  readonly row: ServerStateRow;
  readonly onlinePlayers: OnlinePlayerSummary[];
  readonly onlineByUuid: ReadonlyMap<string, OnlinePlayerSummary>;
} {
  const row = db
    .query<ServerStateRow, []>("SELECT * FROM server_state WHERE id = 1")
    .get();
  if (row === null) {
    throw new Error("storm-stats: missing singleton server_state row");
  }
  const onlinePlayers = isServerSnapshotFresh(row.snapshot_captured_at, nowIso)
    ? parseOnlinePlayersJson(row.online_players_json)
    : [];
  const onlineByUuid = new Map<string, OnlinePlayerSummary>(
    onlinePlayers.map((entry) => [entry.uuid, entry]),
  );
  return { row, onlinePlayers, onlineByUuid };
}

function addWindowPlaytime(
  map: Map<string, { w0: number; w1: number; w2: number }>,
  playerUuid: string,
  bucket: "w0" | "w1" | "w2",
  activeMs: number,
): void {
  if (activeMs <= 0) {
    return;
  }
  const current = map.get(playerUuid) ?? { w0: 0, w1: 0, w2: 0 };
  current[bucket] += activeMs;
  map.set(playerUuid, current);
}

/**
 * Computes Plan's 3-week weighted Activity Index for all players relative to `nowIso`.
 * Combines fine-grained `session_intervals` and any unattributed session remainder
 * `(active_ms - interval_active_ms)` so short sessions without interval ticks are counted.
 */
export function loadAllPlayerActivityScores(
  db: Database,
  nowIso: string,
): ReadonlyMap<string, PlayerActivityScore> {
  const nowMs = new Date(nowIso).getTime();
  const w0StartIso = new Date(nowMs - 7 * DAY_MS).toISOString();
  const w1StartIso = new Date(nowMs - 14 * DAY_MS).toISOString();
  const w2StartIso = new Date(nowMs - 21 * DAY_MS).toISOString();

  const windows = new Map<string, { w0: number; w1: number; w2: number }>();

  const intervals = db
    .query<
      { player_uuid: string; started_at: string; active_ms: number },
      [string, string]
    >(
      `SELECT player_uuid, started_at, active_ms
       FROM session_intervals
       WHERE started_at >= ? AND started_at <= ?`,
    )
    .all(w2StartIso, nowIso);

  for (const row of intervals) {
    if (row.started_at >= w0StartIso) {
      addWindowPlaytime(windows, row.player_uuid, "w0", row.active_ms);
    } else if (row.started_at >= w1StartIso) {
      addWindowPlaytime(windows, row.player_uuid, "w1", row.active_ms);
    } else {
      addWindowPlaytime(windows, row.player_uuid, "w2", row.active_ms);
    }
  }

  const remainders = db
    .query<
      { player_uuid: string; ref_at: string; remainder_ms: number },
      [string, string]
    >(
      `SELECT player_uuid,
              COALESCE(ended_at, started_at) AS ref_at,
              (active_ms - interval_active_ms) AS remainder_ms
       FROM sessions
       WHERE active_ms > interval_active_ms
         AND COALESCE(ended_at, started_at) >= ?
         AND COALESCE(ended_at, started_at) <= ?`,
    )
    .all(w2StartIso, nowIso);

  for (const row of remainders) {
    if (row.ref_at >= w0StartIso) {
      addWindowPlaytime(windows, row.player_uuid, "w0", row.remainder_ms);
    } else if (row.ref_at >= w1StartIso) {
      addWindowPlaytime(windows, row.player_uuid, "w1", row.remainder_ms);
    } else {
      addWindowPlaytime(windows, row.player_uuid, "w2", row.remainder_ms);
    }
  }

  const players = db
    .query<{ uuid: string }, []>("SELECT uuid FROM players")
    .all();
  const scores = new Map<string, PlayerActivityScore>();
  for (const player of players) {
    const w = windows.get(player.uuid);
    scores.set(
      player.uuid,
      computeActivityIndex(w?.w0 ?? 0, w?.w1 ?? 0, w?.w2 ?? 0),
    );
  }
  return scores;
}

export function summarizePlayerbaseGroups(
  scores: Iterable<PlayerActivityScore>,
): PlayerbaseBreakdown {
  let regular = 0;
  let active = 0;
  let irregular = 0;
  let inactive = 0;
  for (const item of scores) {
    switch (item.activityGroup) {
      case "regular":
        regular += 1;
        break;
      case "active":
        active += 1;
        break;
      case "irregular":
        irregular += 1;
        break;
      case "inactive":
        inactive += 1;
        break;
    }
  }
  return {
    regular,
    active,
    irregular,
    inactive,
    total: regular + active + irregular + inactive,
  };
}

function parseWorldBucketOrFallback(raw: string | undefined): WorldBucket {
  const parsed = WorldBucketSchema.safeParse(raw);
  return parsed.success ? parsed.data : "world";
}

function parseGameModeOrFallback(raw: string | undefined): GameMode {
  const parsed = GameModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : "survival";
}

export function loadPrimaryWorldAndModeByPlayer(db: Database): {
  readonly primaryWorld: ReadonlyMap<string, WorldBucket>;
  readonly primaryMode: ReadonlyMap<string, GameMode>;
} {
  const worldRows = db
    .query<{ player_uuid: string; world: string; total_ms: number }, []>(
      `SELECT player_uuid, world, SUM(connected_ms) AS total_ms
       FROM session_intervals
       GROUP BY player_uuid, world
       ORDER BY total_ms DESC`,
    )
    .all();
  const primaryWorld = new Map<string, WorldBucket>();
  for (const row of worldRows) {
    if (!primaryWorld.has(row.player_uuid)) {
      primaryWorld.set(row.player_uuid, parseWorldBucketOrFallback(row.world));
    }
  }

  const modeRows = db
    .query<{ player_uuid: string; mode: string; total_ms: number }, []>(
      `SELECT player_uuid, mode, SUM(connected_ms) AS total_ms
       FROM session_intervals
       GROUP BY player_uuid, mode
       ORDER BY total_ms DESC`,
    )
    .all();
  const primaryMode = new Map<string, GameMode>();
  for (const row of modeRows) {
    if (!primaryMode.has(row.player_uuid)) {
      primaryMode.set(row.player_uuid, parseGameModeOrFallback(row.mode));
    }
  }

  return { primaryWorld, primaryMode };
}

export function loadPrimaryWorldAndModeForSessions(
  db: Database,
  sessionIds: readonly string[],
): {
  readonly worldBySession: ReadonlyMap<string, WorldBucket>;
  readonly modeBySession: ReadonlyMap<string, GameMode>;
} {
  const worldBySession = new Map<string, WorldBucket>();
  const modeBySession = new Map<string, GameMode>();
  if (sessionIds.length === 0) {
    return { worldBySession, modeBySession };
  }
  const placeholders = sessionIds.map(() => "?").join(", ");
  const worldRows = db
    .query<{ session_id: string; world: string; total_ms: number }, string[]>(
      `SELECT session_id, world, SUM(connected_ms) AS total_ms
       FROM session_intervals
       WHERE session_id IN (${placeholders})
       GROUP BY session_id, world
       ORDER BY total_ms DESC`,
    )
    .all(...sessionIds);
  for (const row of worldRows) {
    if (!worldBySession.has(row.session_id)) {
      worldBySession.set(row.session_id, parseWorldBucketOrFallback(row.world));
    }
  }

  const modeRows = db
    .query<{ session_id: string; mode: string; total_ms: number }, string[]>(
      `SELECT session_id, mode, SUM(connected_ms) AS total_ms
       FROM session_intervals
       WHERE session_id IN (${placeholders})
       GROUP BY session_id, mode
       ORDER BY total_ms DESC`,
    )
    .all(...sessionIds);
  for (const row of modeRows) {
    if (!modeBySession.has(row.session_id)) {
      modeBySession.set(row.session_id, parseGameModeOrFallback(row.mode));
    }
  }
  return { worldBySession, modeBySession };
}

export function toSessionSummaries(
  db: Database,
  rows: readonly SessionRow[],
): SessionSummary[] {
  const ids = rows.map((r) => r.session_id);
  const { worldBySession, modeBySession } = loadPrimaryWorldAndModeForSessions(
    db,
    ids,
  );
  return rows.map((row) => ({
    sessionId: row.session_id,
    playerUuid: row.player_uuid,
    playerName: row.player_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ongoing: row.ongoing === 1,
    connectedMs: row.connected_ms,
    activeMs: row.active_ms,
    primaryWorld: worldBySession.get(row.session_id) ?? "world",
    primaryMode: modeBySession.get(row.session_id) ?? "survival",
    platform: row.platform,
    pvpKills: row.pvp_kills,
    mobKills: row.mob_kills,
    deaths: row.deaths,
  }));
}

export type DirectoryRowBuildContext = {
  readonly onlineByUuid: ReadonlyMap<string, OnlinePlayerSummary>;
  readonly activityByUuid: ReadonlyMap<string, PlayerActivityScore>;
  readonly primaryWorldByUuid: ReadonlyMap<string, WorldBucket>;
  readonly primaryModeByUuid: ReadonlyMap<string, GameMode>;
  readonly gameplayByUuid: ReadonlyMap<string, PlayerGameplayRow>;
  readonly viewer: ViewerRole;
};

export function buildPlayerDirectoryRow(
  row: PlayerRow,
  ctx: DirectoryRowBuildContext,
): PlayerDirectoryRow {
  const onlineEntry = ctx.onlineByUuid.get(row.uuid);
  const score = ctx.activityByUuid.get(row.uuid) ?? {
    activityIndex: 0,
    activityGroup: "inactive" as const,
  };
  const gameplay = ctx.gameplayByUuid.get(row.uuid);
  const pingAvgMs =
    row.ping_count > 0 ? Math.round(row.ping_sum_ms / row.ping_count) : null;

  const base: PlayerDirectoryRow = {
    uuid: row.uuid,
    name: row.name,
    nickname: row.nickname,
    online: onlineEntry !== undefined,
    activityIndex: score.activityIndex,
    activityGroup: score.activityGroup,
    primaryGroup: row.primary_group,
    platform: row.platform,
    clientVersion: row.client_version,
    connectedMs: row.connected_ms,
    activeMs: row.active_ms,
    sessionsCount: row.sessions_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    primaryWorld:
      ctx.primaryWorldByUuid.get(row.uuid) ?? onlineEntry?.world ?? "world",
    primaryMode:
      ctx.primaryModeByUuid.get(row.uuid) ?? onlineEntry?.mode ?? "survival",
    coins: gameplay?.coins ?? 0,
    townName: gameplay?.town_name ?? null,
    powerLevel: gameplay?.power_level ?? 0,
    pvpKills: row.pvp_kills,
    pvpDeaths: row.pvp_deaths,
    pingAvgMs,
  };

  if (ctx.viewer === "staff") {
    return {
      ...base,
      staff: {
        countryCode: row.last_country_code,
        countryName: row.last_country_name,
        lastJoinAddress: row.last_join_address,
        bouncesCount: row.bounces_count,
      },
    };
  }
  return base;
}

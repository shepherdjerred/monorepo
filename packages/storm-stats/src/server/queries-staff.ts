import type { Database } from "bun:sqlite";
import {
  BOUNCE_CATEGORIES,
  BounceCategorySchema,
  PlatformSchema,
  type BounceCategory,
  type Platform,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import type {
  StaffBouncesResponse,
  StaffNetworkResponse,
  StaffPlayerOverlayResponse,
  StaffQueryResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import {
  compareDirectoryRows,
  findPlayerRowByIdOrName,
  loadAllDirectoryRows,
  queryPlayerProfile,
} from "./queries-players.ts";
import {
  matchesStaffQueryFilters,
  type StaffQueryFilters,
} from "./queries-staff-filters.ts";
import type { SessionRow } from "./schema.ts";
import { msToHours, safePercent } from "./time.ts";

export function queryStaffNetwork(
  db: Database,
  nowIso: string,
): StaffNetworkResponse {
  const countryRows = db
    .query<
      {
        country_code: string;
        country_name: string | null;
        players: number;
        ping_sum: number;
        ping_count: number;
      },
      []
    >(
      `SELECT last_country_code AS country_code,
              MAX(last_country_name) AS country_name,
              COUNT(*) AS players,
              SUM(ping_sum_ms) AS ping_sum,
              SUM(ping_count) AS ping_count
       FROM players
       WHERE last_country_code IS NOT NULL
       GROUP BY last_country_code
       ORDER BY players DESC, country_code ASC`,
    )
    .all();

  const totalGeoPlayers = countryRows.reduce((acc, r) => acc + r.players, 0);
  const countries = countryRows.map((r) => ({
    countryCode: r.country_code,
    countryName: r.country_name ?? r.country_code,
    players: r.players,
    sharePercent: safePercent(r.players, totalGeoPlayers),
    pingAvgMs: r.ping_count > 0 ? Math.round(r.ping_sum / r.ping_count) : null,
  }));

  const joinRows = db
    .query<
      {
        join_address: string;
        players: number;
        sessions: number;
        last_seen_at: string;
      },
      []
    >(
      `SELECT join_address,
              COUNT(DISTINCT player_uuid) AS players,
              COUNT(*) AS sessions,
              MAX(COALESCE(ended_at, started_at)) AS last_seen_at
       FROM sessions
       WHERE join_address IS NOT NULL
       GROUP BY join_address
       ORDER BY sessions DESC, join_address ASC`,
    )
    .all();

  return {
    generatedAt: nowIso,
    countries,
    joinAddresses: joinRows.map((r) => ({
      joinAddress: r.join_address,
      players: r.players,
      sessions: r.sessions,
      lastSeenAt: r.last_seen_at,
    })),
  };
}

function parseBounceCategoryOrOther(raw: string): BounceCategory {
  const parsed = BounceCategorySchema.safeParse(raw);
  return parsed.success ? parsed.data : "other";
}

export function queryStaffBounces(
  db: Database,
  nowIso: string,
): StaffBouncesResponse {
  const categoryRows = db
    .query<{ category: string; count: number; unique_players: number }, []>(
      `SELECT category,
              COUNT(*) AS count,
              COUNT(DISTINCT COALESCE(player_uuid, lower(player_name))) AS unique_players
       FROM connection_bounces
       GROUP BY category`,
    )
    .all();

  const countsByCategory = new Map<
    BounceCategory,
    { count: number; uniquePlayers: number }
  >();
  for (const cat of BOUNCE_CATEGORIES) {
    countsByCategory.set(cat, { count: 0, uniquePlayers: 0 });
  }
  for (const row of categoryRows) {
    const cat = parseBounceCategoryOrOther(row.category);
    const prev = countsByCategory.get(cat) ?? { count: 0, uniquePlayers: 0 };
    countsByCategory.set(cat, {
      count: prev.count + row.count,
      uniquePlayers: prev.uniquePlayers + row.unique_players,
    });
  }

  const byCategory = BOUNCE_CATEGORIES.map((category) => {
    const info = countsByCategory.get(category) ?? {
      count: 0,
      uniquePlayers: 0,
    };
    return {
      category,
      count: info.count,
      uniquePlayers: info.uniquePlayers,
    };
  }).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const recentRows = db
    .query<
      {
        event_id: string;
        occurred_at: string;
        player_uuid: string | null;
        player_name: string;
        category: string;
        reason: string;
        join_address: string | null;
      },
      []
    >(
      `SELECT event_id, occurred_at, player_uuid, player_name,
              category, reason, join_address
       FROM connection_bounces
       ORDER BY occurred_at DESC
       LIMIT 100`,
    )
    .all();

  return {
    generatedAt: nowIso,
    byCategory,
    recentBounces: recentRows.map((r) => ({
      eventId: r.event_id,
      occurredAt: r.occurred_at,
      playerUuid: r.player_uuid,
      playerName: r.player_name,
      category: parseBounceCategoryOrOther(r.category),
      reason: r.reason,
      joinAddress: r.join_address,
    })),
  };
}

export function queryStaffSegment(
  db: Database,
  filters: StaffQueryFilters,
  nowIso: string,
): StaffQueryResponse {
  const nowMs = new Date(nowIso).getTime();
  const sort = filters.sort ?? "activePlaytime";
  const order = filters.order ?? (sort === "name" ? "asc" : "desc");
  const limit = Math.min(500, Math.max(1, filters.limit ?? 100));

  const allRows = loadAllDirectoryRows(db, "staff", nowIso);
  const matched = allRows.filter((row) =>
    matchesStaffQueryFilters(row, filters, nowMs),
  );
  matched.sort((a, b) => compareDirectoryRows(a, b, sort, order));

  let sumConnectedMs = 0;
  let sumActiveMs = 0;
  let totalSessions = 0;
  let regularCount = 0;
  let activeCount = 0;
  let irregularCount = 0;
  let inactiveCount = 0;

  for (const row of matched) {
    sumConnectedMs += row.connectedMs;
    sumActiveMs += row.activeMs;
    totalSessions += row.sessionsCount;
    switch (row.activityGroup) {
      case "regular":
        regularCount += 1;
        break;
      case "active":
        activeCount += 1;
        break;
      case "irregular":
        irregularCount += 1;
        break;
      case "inactive":
        inactiveCount += 1;
        break;
    }
  }

  return {
    generatedAt: nowIso,
    summary: {
      matchedPlayers: matched.length,
      totalConnectedHours: msToHours(sumConnectedMs),
      totalActiveHours: msToHours(sumActiveMs),
      meanActiveHours:
        matched.length > 0 ? msToHours(sumActiveMs / matched.length) : 0,
      totalSessions,
      regularCount,
      activeCount,
      irregularCount,
      inactiveCount,
    },
    players: matched.slice(0, limit),
  };
}

export function queryStaffPlayerOverlay(
  db: Database,
  idOrName: string,
  nowIso: string,
): StaffPlayerOverlayResponse | null {
  const player = findPlayerRowByIdOrName(db, idOrName);
  if (player === null) {
    return null;
  }

  const joinRows = db
    .query<
      { join_address: string; sessions: number; last_used_at: string },
      [string]
    >(
      `SELECT join_address,
              COUNT(*) AS sessions,
              MAX(COALESCE(ended_at, started_at)) AS last_used_at
       FROM sessions
       WHERE player_uuid = ? AND join_address IS NOT NULL
       GROUP BY join_address
       ORDER BY sessions DESC, last_used_at DESC`,
    )
    .all(player.uuid);

  const geoRows = db
    .query<
      {
        country_code: string;
        country_name: string | null;
        sessions: number;
        last_seen_at: string;
      },
      [string]
    >(
      `SELECT country_code,
              MAX(country_name) AS country_name,
              COUNT(*) AS sessions,
              MAX(COALESCE(ended_at, started_at)) AS last_seen_at
       FROM sessions
       WHERE player_uuid = ? AND country_code IS NOT NULL
       GROUP BY country_code
       ORDER BY sessions DESC, last_seen_at DESC`,
    )
    .all(player.uuid);

  const brandRows = db
    .query<
      {
        brand: string | null;
        client_version: string;
        platform: string;
        last_seen_at: string;
      },
      [string]
    >(
      `SELECT client_brand AS brand,
              client_version,
              platform,
              MAX(COALESCE(ended_at, started_at)) AS last_seen_at
       FROM sessions
       WHERE player_uuid = ?
       GROUP BY COALESCE(client_brand, ''), client_version, platform
       ORDER BY last_seen_at DESC`,
    )
    .all(player.uuid);

  const bounceRows = db
    .query<
      {
        event_id: string;
        occurred_at: string;
        category: string;
        reason: string;
        join_address: string | null;
      },
      [string, string]
    >(
      `SELECT event_id, occurred_at, category, reason, join_address
       FROM connection_bounces
       WHERE player_uuid = ? OR (player_uuid IS NULL AND lower(player_name) = ?)
       ORDER BY occurred_at DESC
       LIMIT 50`,
    )
    .all(player.uuid, player.name_lower);

  return {
    generatedAt: nowIso,
    uuid: player.uuid,
    name: player.name,
    joinAddresses: joinRows.map((r) => ({
      joinAddress: r.join_address,
      sessions: r.sessions,
      lastUsedAt: r.last_used_at,
    })),
    geolocations: geoRows.map((r) => ({
      countryCode: r.country_code,
      countryName: r.country_name ?? r.country_code,
      sessions: r.sessions,
      lastSeenAt: r.last_seen_at,
    })),
    clientBrands: brandRows.map((r) => {
      const platformParsed = PlatformSchema.safeParse(r.platform);
      const platform: Platform = platformParsed.success
        ? platformParsed.data
        : "java";
      return {
        brand:
          r.brand ?? (platform === "bedrock" ? "Geyser/Bedrock" : "vanilla"),
        clientVersion: r.client_version,
        platform,
        lastSeenAt: r.last_seen_at,
      };
    }),
    bounces: bounceRows.map((r) => ({
      eventId: r.event_id,
      occurredAt: r.occurred_at,
      category: parseBounceCategoryOrOther(r.category),
      reason: r.reason,
      joinAddress: r.join_address,
    })),
  };
}

export function queryStaffPlayerRaw(
  db: Database,
  idOrName: string,
  nowIso: string,
): Record<string, unknown> | null {
  const player = findPlayerRowByIdOrName(db, idOrName);
  if (player === null) {
    return null;
  }
  const profile = queryPlayerProfile(db, player.uuid, nowIso);
  const staffOverlay = queryStaffPlayerOverlay(db, player.uuid, nowIso);
  const sessions = db
    .query<SessionRow, [string]>(
      "SELECT * FROM sessions WHERE player_uuid = ? ORDER BY started_at DESC LIMIT 200",
    )
    .all(player.uuid);
  const intervals = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM session_intervals WHERE player_uuid = ? ORDER BY started_at DESC LIMIT 500",
    )
    .all(player.uuid);

  return {
    generatedAt: nowIso,
    playerRow: player,
    profile,
    staffOverlay,
    sessions,
    intervals,
  };
}

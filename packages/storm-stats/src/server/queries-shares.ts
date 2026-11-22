import type { Database } from "bun:sqlite";
import {
  GAME_MODES,
  GameModeSchema,
  WORLD_BUCKETS,
  WorldBucketSchema,
  type GameMode,
  type ModeShare,
  type WorldBucket,
  type WorldShare,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import { MODE_LABELS, WORLD_LABELS } from "./schema.ts";
import { msToHours, safePercent } from "./time.ts";

export function buildWorldShares(
  db: Database,
  playerUuid?: string,
): WorldShare[] {
  const rows =
    playerUuid === undefined
      ? db
          .query<
            { world: string; connected_ms: number; active_ms: number },
            []
          >(
            `SELECT world, SUM(connected_ms) AS connected_ms, SUM(active_ms) AS active_ms
             FROM session_intervals GROUP BY world`,
          )
          .all()
      : db
          .query<
            { world: string; connected_ms: number; active_ms: number },
            [string]
          >(
            `SELECT world, SUM(connected_ms) AS connected_ms, SUM(active_ms) AS active_ms
             FROM session_intervals WHERE player_uuid = ? GROUP BY world`,
          )
          .all(playerUuid);

  const remainderRow =
    playerUuid === undefined
      ? db
          .query<{ rem_c: number | null; rem_a: number | null }, []>(
            `SELECT SUM(MAX(0, connected_ms - interval_connected_ms)) AS rem_c,
                    SUM(MAX(0, active_ms - interval_active_ms)) AS rem_a
             FROM sessions`,
          )
          .get()
      : db
          .query<{ rem_c: number | null; rem_a: number | null }, [string]>(
            `SELECT SUM(MAX(0, connected_ms - interval_connected_ms)) AS rem_c,
                    SUM(MAX(0, active_ms - interval_active_ms)) AS rem_a
             FROM sessions WHERE player_uuid = ?`,
          )
          .get(playerUuid);

  const totals = new Map<
    WorldBucket,
    { connectedMs: number; activeMs: number }
  >();
  for (const w of WORLD_BUCKETS) {
    totals.set(w, { connectedMs: 0, activeMs: 0 });
  }
  for (const row of rows) {
    const parsed = WorldBucketSchema.safeParse(row.world);
    const key: WorldBucket = parsed.success ? parsed.data : "other";
    const entry = totals.get(key) ?? { connectedMs: 0, activeMs: 0 };
    entry.connectedMs += row.connected_ms;
    entry.activeMs += row.active_ms;
    totals.set(key, entry);
  }

  const remConnected = remainderRow?.rem_c ?? 0;
  const remActive = remainderRow?.rem_a ?? 0;
  if (remConnected > 0 || remActive > 0) {
    const overworld = totals.get("world") ?? { connectedMs: 0, activeMs: 0 };
    overworld.connectedMs += remConnected;
    overworld.activeMs += remActive;
    totals.set("world", overworld);
  }

  let grandConnectedMs = 0;
  for (const v of totals.values()) {
    grandConnectedMs += v.connectedMs;
  }

  const shares: WorldShare[] = WORLD_BUCKETS.map((world) => {
    const v = totals.get(world) ?? { connectedMs: 0, activeMs: 0 };
    return {
      world,
      label: WORLD_LABELS[world],
      connectedHours: msToHours(v.connectedMs),
      activeHours: msToHours(v.activeMs),
      sharePercent: safePercent(v.connectedMs, grandConnectedMs),
    };
  });

  const nonZero = shares.filter((s) => s.connectedHours > 0);
  const selected = nonZero.length > 0 ? nonZero : shares.slice(0, 1);
  return selected.sort(
    (a, b) =>
      b.connectedHours - a.connectedHours || a.world.localeCompare(b.world),
  );
}

export function buildModeShares(
  db: Database,
  playerUuid?: string,
): ModeShare[] {
  const rows =
    playerUuid === undefined
      ? db
          .query<
            {
              mode: string;
              connected_ms: number;
              active_ms: number;
              players: number;
            },
            []
          >(
            `SELECT mode, SUM(connected_ms) AS connected_ms, SUM(active_ms) AS active_ms,
                    COUNT(DISTINCT player_uuid) AS players
             FROM session_intervals GROUP BY mode`,
          )
          .all()
      : db
          .query<
            {
              mode: string;
              connected_ms: number;
              active_ms: number;
              players: number;
            },
            [string]
          >(
            `SELECT mode, SUM(connected_ms) AS connected_ms, SUM(active_ms) AS active_ms,
                    COUNT(DISTINCT player_uuid) AS players
             FROM session_intervals WHERE player_uuid = ? GROUP BY mode`,
          )
          .all(playerUuid);

  const remainderRow =
    playerUuid === undefined
      ? db
          .query<
            { rem_c: number | null; rem_a: number | null; players: number },
            []
          >(
            `SELECT SUM(MAX(0, connected_ms - interval_connected_ms)) AS rem_c,
                    SUM(MAX(0, active_ms - interval_active_ms)) AS rem_a,
                    COUNT(DISTINCT CASE WHEN connected_ms > interval_connected_ms THEN player_uuid END) AS players
             FROM sessions`,
          )
          .get()
      : db
          .query<
            { rem_c: number | null; rem_a: number | null; players: number },
            [string]
          >(
            `SELECT SUM(MAX(0, connected_ms - interval_connected_ms)) AS rem_c,
                    SUM(MAX(0, active_ms - interval_active_ms)) AS rem_a,
                    COUNT(DISTINCT CASE WHEN connected_ms > interval_connected_ms THEN player_uuid END) AS players
             FROM sessions WHERE player_uuid = ?`,
          )
          .get(playerUuid);

  const totals = new Map<
    GameMode,
    { connectedMs: number; activeMs: number; uniquePlayers: number }
  >();
  for (const m of GAME_MODES) {
    totals.set(m, { connectedMs: 0, activeMs: 0, uniquePlayers: 0 });
  }
  for (const row of rows) {
    const parsed = GameModeSchema.safeParse(row.mode);
    const key: GameMode = parsed.success ? parsed.data : "survival";
    const entry = totals.get(key) ?? {
      connectedMs: 0,
      activeMs: 0,
      uniquePlayers: 0,
    };
    entry.connectedMs += row.connected_ms;
    entry.activeMs += row.active_ms;
    entry.uniquePlayers = Math.max(entry.uniquePlayers, row.players);
    totals.set(key, entry);
  }

  const remConnected = remainderRow?.rem_c ?? 0;
  const remActive = remainderRow?.rem_a ?? 0;
  if (remConnected > 0 || remActive > 0) {
    const survival = totals.get("survival") ?? {
      connectedMs: 0,
      activeMs: 0,
      uniquePlayers: 0,
    };
    survival.connectedMs += remConnected;
    survival.activeMs += remActive;
    survival.uniquePlayers = Math.max(
      survival.uniquePlayers,
      remainderRow?.players ?? 0,
    );
    totals.set("survival", survival);
  }

  let grandConnectedMs = 0;
  for (const v of totals.values()) {
    grandConnectedMs += v.connectedMs;
  }

  return GAME_MODES.map((mode) => {
    const v = totals.get(mode) ?? {
      connectedMs: 0,
      activeMs: 0,
      uniquePlayers: 0,
    };
    return {
      mode,
      label: MODE_LABELS[mode],
      connectedHours: msToHours(v.connectedMs),
      activeHours: msToHours(v.activeMs),
      uniquePlayers: v.uniquePlayers,
      sharePercent: safePercent(v.connectedMs, grandConnectedMs),
    };
  }).sort(
    (a, b) =>
      b.connectedHours - a.connectedHours || a.mode.localeCompare(b.mode),
  );
}

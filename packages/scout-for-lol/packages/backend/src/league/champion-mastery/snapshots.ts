import {
  LeaguePuuidSchema,
  RawChampionMasteryListSchema,
  regionToPlatformRoute,
  type LeaguePuuid,
  type RawChampionMastery,
  type Region,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { riotClient } from "#src/league/api/api.ts";
import {
  RiotHttpError,
  RiotTransportError,
} from "#src/league/api/client/errors.ts";
import { championMasterySnapshotReadsTotal } from "#src/metrics/champion-mastery.ts";

const FRESH_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export type ChampionMasterySnapshot = {
  entries: RawChampionMastery[];
  fetchedAt: Date;
  freshness: "fresh" | "stale";
};

function parseEntries(entriesJson: string): RawChampionMastery[] {
  return RawChampionMasteryListSchema.parse(JSON.parse(entriesJson));
}

function isFresh(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() < FRESH_FOR_MS;
}

function snapshotFromRow(
  input: {
    entriesJson: string;
    fetchedAt: Date;
  },
  freshness: ChampionMasterySnapshot["freshness"],
): ChampionMasterySnapshot {
  return {
    entries: parseEntries(input.entriesJson),
    fetchedAt: input.fetchedAt,
    freshness,
  };
}

export async function refreshChampionMasterySnapshot(input: {
  puuid: LeaguePuuid | string;
  region: Region;
  database?: ExtendedPrismaClient;
}): Promise<ChampionMasterySnapshot> {
  const database = input.database ?? prisma;
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const entries = await riotClient.championMastery.byPuuid(
    puuid,
    regionToPlatformRoute(input.region),
  );
  const fetchedAt = new Date();
  await database.championMasterySnapshot.upsert({
    where: { puuid },
    create: { puuid, entriesJson: JSON.stringify(entries), fetchedAt },
    update: { entriesJson: JSON.stringify(entries), fetchedAt },
  });
  return { entries, fetchedAt, freshness: "fresh" };
}

/**
 * Return a current mastery snapshot when possible. Riot is an expected
 * external boundary: an old, valid snapshot is useful, but an absent one is
 * not fabricated and never prevents the caller's primary surface from loading.
 */
export async function getChampionMasterySnapshot(input: {
  puuid: LeaguePuuid | string;
  region: Region;
  database?: ExtendedPrismaClient;
  now?: Date;
}): Promise<ChampionMasterySnapshot | undefined> {
  const database = input.database ?? prisma;
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const now = input.now ?? new Date();
  const stored = await database.championMasterySnapshot.findUnique({
    where: { puuid },
    select: { entriesJson: true, fetchedAt: true },
  });
  if (stored !== null && isFresh(stored.fetchedAt, now)) {
    championMasterySnapshotReadsTotal.inc({ outcome: "cache_fresh" });
    return snapshotFromRow(stored, "fresh");
  }
  try {
    const snapshot = await refreshChampionMasterySnapshot({
      puuid,
      region: input.region,
      database,
    });
    championMasterySnapshotReadsTotal.inc({ outcome: "riot_success" });
    return snapshot;
  } catch (error) {
    // Only Riot's typed response failures are an expected boundary here. A
    // database write or malformed persisted contract must remain visible to
    // callers instead of being mislabeled as a stale Riot fallback.
    if (
      !(error instanceof RiotHttpError) &&
      !(error instanceof RiotTransportError)
    ) {
      throw error;
    }
    if (stored === null) {
      championMasterySnapshotReadsTotal.inc({ outcome: "unavailable" });
      return undefined;
    }
    championMasterySnapshotReadsTotal.inc({ outcome: "stale_fallback" });
    return snapshotFromRow(stored, "stale");
  }
}

export async function getCachedChampionMasterySnapshots(input: {
  puuids: readonly string[];
  database?: ExtendedPrismaClient;
  now?: Date;
}): Promise<Map<string, ChampionMasterySnapshot>> {
  if (input.puuids.length === 0) return new Map();
  const now = input.now ?? new Date();
  const database = input.database ?? prisma;
  const rows = await database.championMasterySnapshot.findMany({
    where: { puuid: { in: [...new Set(input.puuids)] } },
    select: { puuid: true, entriesJson: true, fetchedAt: true },
  });
  return new Map(
    rows.map((row) => [
      row.puuid,
      snapshotFromRow(row, isFresh(row.fetchedAt, now) ? "fresh" : "stale"),
    ]),
  );
}

export function topChampionMastery(
  entries: readonly RawChampionMastery[],
  count: number,
): RawChampionMastery[] {
  return entries
    .toSorted((left, right) => {
      const points = right.championPoints - left.championPoints;
      return points === 0 ? right.championLevel - left.championLevel : points;
    })
    .slice(0, count);
}

export function masteryForChampion(
  entries: readonly RawChampionMastery[],
  championId: number,
): RawChampionMastery | undefined {
  return entries.find((entry) => entry.championId === championId);
}

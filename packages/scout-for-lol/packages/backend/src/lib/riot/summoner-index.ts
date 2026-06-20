/**
 * Self-maintaining cache of known summoners (the `SummonerIndex` table).
 *
 * Powers fast prefix autocomplete in the web "add player" flow. It is
 * populated by `recordRiotResolution` on every confirmed Riot lookup (and a
 * one-off `backfillFromExisting`), and self-heals: a Riot ID that no longer
 * resolves is evicted. Riot IDs are public, so the index is global; the
 * *search* procedure that reads it is still guild-admin gated.
 */

import { LeaguePuuidSchema, RegionSchema } from "@scout-for-lol/data";
import type { Prisma } from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("summoner-index");

export type SummonerSuggestion = {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: string;
};

/** Split `gameName#tagLine` on the last `#` (game names can't contain `#`). */
export function parseRiotId(
  riotId: string,
): { gameName: string; tagLine: string } | null {
  const hash = riotId.lastIndexOf("#");
  if (hash <= 0 || hash === riotId.length - 1) return null;
  return { gameName: riotId.slice(0, hash), tagLine: riotId.slice(hash + 1) };
}

/** Prefix search over `gameName` (SQLite `LIKE 'q%'`, ASCII case-insensitive). */
export async function searchIndex(
  query: string,
  limit: number,
): Promise<SummonerSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const rows = await prisma.summonerIndex.findMany({
    where: { gameName: { startsWith: trimmed } },
    orderBy: [{ gameName: "asc" }, { id: "asc" }],
    take: limit,
  });
  return rows.map((row) => ({
    puuid: row.puuid,
    gameName: row.gameName,
    tagLine: row.tagLine,
    region: row.region,
  }));
}

export async function upsertSummoner(input: SummonerSuggestion): Promise<void> {
  // The Prisma client brands `puuid`/`region`; validate before writing and
  // skip rows whose stored region/puuid can't be parsed.
  const puuid = LeaguePuuidSchema.safeParse(input.puuid);
  const region = RegionSchema.safeParse(input.region);
  if (!puuid.success || !region.success) {
    logger.warn("Skipping summoner index upsert: invalid puuid/region", {
      region: input.region,
    });
    return;
  }
  const now = new Date();
  await prisma.summonerIndex.upsert({
    where: { puuid: puuid.data },
    create: {
      puuid: puuid.data,
      gameName: input.gameName,
      tagLine: input.tagLine,
      region: region.data,
      lastVerifiedAt: now,
      createdTime: now,
      updatedTime: now,
    },
    update: {
      gameName: input.gameName,
      tagLine: input.tagLine,
      region: region.data,
      lastVerifiedAt: now,
      updatedTime: now,
    },
  });
}

export async function evictByRiotId(input: {
  gameName: string;
  tagLine: string;
}): Promise<void> {
  await prisma.summonerIndex.deleteMany({
    where: { gameName: input.gameName, tagLine: input.tagLine },
  });
}

/**
 * Maintain the index after a Riot resolution: add on a confirmed hit, evict on
 * a confirmed miss. Fail-soft — a cache write must never break the resolution
 * it piggybacks on.
 */
export async function recordRiotResolution(params: {
  gameName: string;
  tagLine: string;
  region: string;
  puuid: string | null;
}): Promise<void> {
  try {
    if (params.puuid === null) {
      await evictByRiotId({
        gameName: params.gameName,
        tagLine: params.tagLine,
      });
      return;
    }
    await upsertSummoner({
      puuid: params.puuid,
      gameName: params.gameName,
      tagLine: params.tagLine,
      region: params.region,
    });
  } catch (error) {
    logger.warn("Failed to update summoner index", { error });
  }
}

const BACKFILL_BATCH_SIZE = 500;

/**
 * Seed the index from data we already have: every resolved `Account` plus
 * every distinct player observed in a tracked game (`PrematchParticipantFact
 * .riotId`, which is real Riot data from the spectator API).
 *
 * **Incremental + idempotent**: only PUUIDs not already indexed are inserted,
 * so it's cheap to re-run (it runs automatically on each backend startup).
 */
export async function backfillFromExisting(): Promise<{
  inserted: number;
  scanned: number;
}> {
  const indexed = await prisma.summonerIndex.findMany({
    select: { puuid: true },
  });
  const existing = new Set<string>(indexed.map((row) => row.puuid));

  const now = new Date();
  const toCreate = new Map<string, Prisma.SummonerIndexCreateManyInput>();
  const consider = (
    puuid: string,
    gameName: string,
    tagLine: string,
    region: string,
  ) => {
    if (existing.has(puuid) || toCreate.has(puuid)) return;
    const parsedPuuid = LeaguePuuidSchema.safeParse(puuid);
    const parsedRegion = RegionSchema.safeParse(region);
    if (!parsedPuuid.success || !parsedRegion.success) return;
    toCreate.set(puuid, {
      puuid: parsedPuuid.data,
      gameName,
      tagLine,
      region: parsedRegion.data,
      lastVerifiedAt: now,
      createdTime: now,
      updatedTime: now,
    });
  };

  const accounts = await prisma.account.findMany({
    where: { riotGameName: { not: null }, riotTagLine: { not: null } },
    select: {
      puuid: true,
      riotGameName: true,
      riotTagLine: true,
      region: true,
    },
  });
  for (const account of accounts) {
    if (account.riotGameName === null || account.riotTagLine === null) continue;
    consider(
      account.puuid,
      account.riotGameName,
      account.riotTagLine,
      account.region,
    );
  }

  const facts = await prisma.prematchParticipantFact.findMany({
    where: { region: { not: null } },
    select: { puuid: true, riotId: true, region: true },
    distinct: ["puuid"],
  });
  for (const fact of facts) {
    if (fact.region === null) continue;
    const parsed = parseRiotId(fact.riotId);
    if (parsed === null) continue;
    consider(fact.puuid, parsed.gameName, parsed.tagLine, fact.region);
  }

  const rows = [...toCreate.values()];
  for (let i = 0; i < rows.length; i += BACKFILL_BATCH_SIZE) {
    await prisma.summonerIndex.createMany({
      data: rows.slice(i, i + BACKFILL_BATCH_SIZE),
    });
  }

  const scanned = accounts.length + facts.length;
  logger.info("Summoner index backfill complete", {
    inserted: rows.length,
    scanned,
    alreadyIndexed: existing.size,
  });
  return { inserted: rows.length, scanned };
}

/**
 * Resolve and cache the real Riot ID (gameName#tagLine) for stored accounts.
 *
 * Accounts persist only a user-chosen alias + PUUID, so the web UI cannot
 * show the canonical Riot ID without a lookup. We reverse-resolve the PUUID
 * via Riot's Account API and cache the result on the Account row for 24h.
 *
 * Read-path strategy (keeps page loads fast): synchronously refresh only the
 * accounts that have NEVER been resolved (so the first load shows a value),
 * capped per request; everything else that is merely stale is refreshed in
 * the background and served from cache. All refreshes are fail-soft.
 */

import { type Region, RegionSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { riotApi } from "#src/league/api/api.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { regionToRegionGroupForAccountAPI } from "twisted/dist/constants/regions.js";
import { withTimeout } from "#src/utils/timeout.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("account-riot-id");

/** Cached Riot IDs older than this are refreshed. */
const RIOT_ID_TTL_MS = 24 * 60 * 60 * 1000;
/** Max never-resolved accounts to refresh synchronously on a single read. */
const MAX_AWAITED_REFRESHES = 10;

export type RiotIdParts = { gameName: string; tagLine: string };

export type AccountRiotRow = {
  id: number;
  puuid: string;
  region: string;
  riotGameName: string | null;
  riotTagLine: string | null;
  riotIdUpdatedAt: Date | null;
};

/**
 * Reverse-resolve a PUUID to its current Riot ID. Returns null on any
 * failure (invalid region, API error, timeout) so callers can fall back to
 * the cached value or alias.
 */
export async function getRiotIdByPuuid(
  puuid: string,
  region: Region,
): Promise<RiotIdParts | null> {
  try {
    const regionGroup = regionToRegionGroupForAccountAPI(
      mapRegionToEnum(region),
    );
    const account = await withTimeout(
      riotApi.Account.getByPUUID(puuid, regionGroup),
    );
    return {
      gameName: account.response.gameName,
      tagLine: account.response.tagLine,
    };
  } catch (error) {
    logger.warn("Failed to resolve Riot ID by PUUID", { puuid, region, error });
    return null;
  }
}

function isStale(updatedAt: Date | null): boolean {
  return (
    updatedAt === null || Date.now() - updatedAt.getTime() > RIOT_ID_TTL_MS
  );
}

async function refreshOne(
  account: AccountRiotRow,
): Promise<RiotIdParts | null> {
  const region = RegionSchema.safeParse(account.region);
  if (!region.success) {
    logger.warn("Account has an unparseable region; skipping Riot ID refresh", {
      accountId: account.id,
      region: account.region,
    });
    return null;
  }
  const parts = await getRiotIdByPuuid(account.puuid, region.data);
  if (parts === null) return null;
  await prisma.account.update({
    where: { id: account.id },
    data: {
      riotGameName: parts.gameName,
      riotTagLine: parts.tagLine,
      riotIdUpdatedAt: new Date(),
    },
  });
  return parts;
}

/**
 * Refresh stale/never-resolved Riot IDs for a set of accounts. Returns a map
 * of accountId → freshly resolved Riot ID for the accounts refreshed
 * synchronously, so the caller can overlay them onto its already-fetched
 * rows. Stale-but-present accounts are refreshed in the background and not
 * reflected in the returned map (they were served from cache this time).
 */
export async function refreshAccountRiotIds(
  accounts: AccountRiotRow[],
): Promise<Map<number, RiotIdParts>> {
  const resolved = new Map<number, RiotIdParts>();
  const stale = accounts.filter((a) => isStale(a.riotIdUpdatedAt));
  const neverResolved = stale.filter((a) => a.riotGameName === null);
  const staleButPresent = stale.filter((a) => a.riotGameName !== null);

  const toAwait = neverResolved.slice(0, MAX_AWAITED_REFRESHES);
  await Promise.all(
    toAwait.map(async (account) => {
      const parts = await refreshOne(account);
      if (parts !== null) resolved.set(account.id, parts);
    }),
  );

  const background = [
    ...staleButPresent,
    ...neverResolved.slice(MAX_AWAITED_REFRESHES),
  ];
  if (background.length > 0) {
    void (async () => {
      try {
        await Promise.all(background.map((account) => refreshOne(account)));
      } catch (error) {
        logger.warn("Background Riot ID refresh failed", { error });
      }
    })();
  }

  return resolved;
}

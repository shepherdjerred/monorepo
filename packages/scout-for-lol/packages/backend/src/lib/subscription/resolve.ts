import { type Region, type RiotId } from "@scout-for-lol/data/index.ts";
import { riotApi } from "#src/league/api/api.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { regionToRegionGroupForAccountAPI } from "twisted/dist/constants/regions.js";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import { extractHttpStatus } from "#src/league/api/upstream-errors.ts";
import { recordRiotResolution } from "#src/lib/riot/summoner-index.ts";

const logger = createLogger("subscription-resolve");

export type ResolveRiotIdResult =
  | {
      kind: "ok";
      puuid: string;
      /** Riot-canonical casing from the Account API (not the typed input). */
      gameName: string;
      tagLine: string;
    }
  | { kind: "not-found"; message: string };

export async function resolveRiotIdToPuuid(
  riotId: RiotId,
  region: Region,
): Promise<ResolveRiotIdResult> {
  logger.info(
    `🔍 Looking up Riot ID: ${riotId.game_name}#${riotId.tag_line} in region ${region}`,
  );

  try {
    const apiStartTime = Date.now();
    const regionGroup = regionToRegionGroupForAccountAPI(
      mapRegionToEnum(region),
    );

    const account = await withTimeout(
      riotApi.Account.getByRiotId(
        riotId.game_name,
        riotId.tag_line,
        regionGroup,
      ),
    );

    const apiTime = Date.now() - apiStartTime;
    const puuid = account.response.puuid;
    // Riot-canonical casing from the Account API (not the typed input).
    const gameName = account.response.gameName;
    const tagLine = account.response.tagLine;

    logger.info(
      `✅ Resolved Riot ID to PUUID: ${puuid} (${apiTime.toString()}ms)`,
    );
    // Maintain the summoner index: confirmed hit → upsert with canonical casing.
    void recordRiotResolution({
      gameName,
      tagLine,
      region,
      puuid,
    });
    return { kind: "ok", puuid, gameName, tagLine };
  } catch (error) {
    logger.error(
      `❌ Failed to resolve Riot ID ${riotId.game_name}#${riotId.tag_line}:`,
      error,
    );
    // Only evict on a genuine 404 (account doesn't exist / was renamed).
    // Transient errors (timeout, 5xx) must NOT remove a valid cache entry.
    if (extractHttpStatus(error) === 404) {
      void recordRiotResolution({
        gameName: riotId.game_name,
        tagLine: riotId.tag_line,
        region,
        puuid: null,
      });
    }
    return { kind: "not-found", message: getErrorMessage(error) };
  }
}

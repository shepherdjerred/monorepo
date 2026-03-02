import type { Region, RiotId } from "@scout-for-lol/data";
import { riotApi } from "#src/league/api/api.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { regionToRegionGroupForAccountAPI } from "twisted/dist/constants/regions.js";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const logger = createLogger("utils-riot-api");

export type PuuidResolutionSuccess = {
  success: true;
  puuid: string;
  lookupTime: number;
};

export type PuuidResolutionFailure = {
  success: false;
  error: string;
};

export type PuuidResolutionResult =
  | PuuidResolutionSuccess
  | PuuidResolutionFailure;

/**
 * Resolve a Riot ID to a PUUID using Riot's Account API
 * Handles region mapping and error handling
 */
export async function resolvePuuidFromRiotId(
  riotId: RiotId,
  region: Region,
): Promise<PuuidResolutionResult> {
  logger.info(
    `🔍 Looking up Riot ID: ${riotId.game_name}#${riotId.tag_line} in region ${region}`,
  );

  try {
    const apiStartTime = Date.now();
    const regionGroup = regionToRegionGroupForAccountAPI(
      mapRegionToEnum(region),
    );

    logger.info(`🌐 Using region group: ${regionGroup}`);

    const account = await withTimeout(
      riotApi.Account.getByRiotId(
        riotId.game_name,
        riotId.tag_line,
        regionGroup,
      ),
    );

    const lookupTime = Date.now() - apiStartTime;
    const puuid = account.response.puuid;

    logger.info(
      `✅ Successfully resolved Riot ID to PUUID: ${puuid} (${lookupTime.toString()}ms)`,
    );

    return { success: true, puuid, lookupTime };
  } catch (error) {
    logger.error(
      `❌ Failed to resolve Riot ID ${riotId.game_name}#${riotId.tag_line}:`,
      error,
    );
    return { success: false, error: getErrorMessage(error) };
  }
}

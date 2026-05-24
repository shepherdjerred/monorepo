import { type Region, type RiotId } from "@scout-for-lol/data/index.ts";
import { riotApi } from "#src/league/api/api.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { regionToRegionGroupForAccountAPI } from "twisted/dist/constants/regions.js";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const logger = createLogger("subscription-resolve");

export type ResolveRiotIdResult =
  | { kind: "ok"; puuid: string }
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

    logger.info(
      `✅ Resolved Riot ID to PUUID: ${puuid} (${apiTime.toString()}ms)`,
    );
    return { kind: "ok", puuid };
  } catch (error) {
    logger.error(
      `❌ Failed to resolve Riot ID ${riotId.game_name}#${riotId.tag_line}:`,
      error,
    );
    return { kind: "not-found", message: getErrorMessage(error) };
  }
}

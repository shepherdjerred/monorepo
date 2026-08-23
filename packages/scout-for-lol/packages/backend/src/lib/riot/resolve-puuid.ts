import {
  type Region,
  type RiotId,
  platformToAccountRegionalRoute,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import { extractHttpStatus } from "#src/league/api/upstream-errors.ts";
import { recordRiotResolution } from "#src/lib/riot/summoner-index.ts";

const logger = createLogger("resolve-puuid");

export type PuuidResolutionResult =
  | { success: true; puuid: string; lookupTime: number }
  | { success: false; error: string };

export type RiotIdResolutionResult =
  | {
      kind: "ok";
      puuid: string;
      gameName: string;
      tagLine: string;
      lookupTime: number;
    }
  | { kind: "not-found"; message: string };

export async function resolveRiotIdToPuuid(
  riotId: RiotId,
  region: Region,
): Promise<RiotIdResolutionResult> {
  logger.info(
    `🔍 Looking up Riot ID: ${riotId.game_name}#${riotId.tag_line} in region ${region}`,
  );

  try {
    const apiStartTime = Date.now();
    const regionalRoute = platformToAccountRegionalRoute(region);
    const account = await withTimeout(
      riotClient.account.getByRiotId(
        riotId.game_name,
        riotId.tag_line,
        regionalRoute,
      ),
    );
    const lookupTime = Date.now() - apiStartTime;
    const puuid = account.puuid;
    const gameName = account.gameName;
    const tagLine = account.tagLine;
    logger.info(
      `✅ Successfully resolved Riot ID to PUUID: ${puuid} (${lookupTime.toString()}ms)`,
    );
    void recordRiotResolution({ gameName, tagLine, region, puuid });
    return { kind: "ok", puuid, gameName, tagLine, lookupTime };
  } catch (error) {
    logger.error(
      `❌ Failed to resolve Riot ID ${riotId.game_name}#${riotId.tag_line}:`,
      error,
    );
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

export async function resolvePuuidFromRiotId(
  riotId: RiotId,
  region: Region,
): Promise<PuuidResolutionResult> {
  const result = await resolveRiotIdToPuuid(riotId, region);
  return result.kind === "ok"
    ? { success: true, puuid: result.puuid, lookupTime: result.lookupTime }
    : { success: false, error: result.message };
}

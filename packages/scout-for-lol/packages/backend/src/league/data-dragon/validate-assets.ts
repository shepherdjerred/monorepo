import {
  getChampionList,
  validateChampionImage,
  validateChampionLoadingImage,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { getAllChampions, resolveChampionKey } from "#src/utils/champion.ts";

const logger = createLogger("validate-assets");

// Crashes the pod at startup if any Data Dragon champion asset is missing.
// Two parallel passes:
//   1. Iterate every champion Twisted knows and resolve via
//      `resolveChampionKey` — catches stale `championNameOverrides`
//      generated map drift.
//   2. Iterate every key in the bundled `champion.json` directly — catches
//      Riot match-data casing quirks (e.g. `participant.championName`
//      returning `"FiddleSticks"`) that the Twisted-driven pass can't
//      observe because Twisted produces canonical PascalCase output.
// Every check runs the actual on-disk lookup that production code uses,
// so any name-resolution divergence between callers is caught at deploy
// time rather than at notification time.
export async function validateChampionAssets(): Promise<void> {
  const twistedChampions = getAllChampions();
  const dataDragonChampions = await getChampionList();
  const totalChecks = twistedChampions.length + dataDragonChampions.length;
  logger.info(
    `🖼️  Validating Data Dragon assets for ${String(totalChecks)} champion entries (${String(twistedChampions.length)} via Twisted, ${String(dataDragonChampions.length)} via champion.json)`,
  );

  const failures: Error[] = [];

  for (const { id } of twistedChampions) {
    const key = resolveChampionKey(id);

    try {
      await validateChampionImage(key);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      await validateChampionLoadingImage(key, 0);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  for (const { id } of dataDragonChampions) {
    try {
      await validateChampionImage(id);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      await validateChampionLoadingImage(id, 0);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Missing Data Dragon champion assets (${String(failures.length)} failure${failures.length === 1 ? "" : "s"}). Run 'bun run update-data-dragon' in packages/data.`,
    );
  }

  logger.info("✅ All champion assets present");
}

import {
  getChampionList,
  validateChampionImage,
  validateChampionLoadingImage,
  validateChampionSplashImage,
  validateClassicChampionCatalog,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { getAllChampions, resolveChampionKey } from "#src/utils/champion.ts";

const logger = createLogger("validate-assets");

/**
 * Crashes the pod at startup if any Data Dragon champion asset is missing.
 * Two parallel passes:
 *   1. Iterate every champion in the registry and resolve via `resolveChampionKey`.
 *   2. Iterate every key in the bundled `champion.json` directly.
 */
export async function validateChampionAssets(): Promise<void> {
  validateClassicChampionCatalog();
  const registryChampions = getAllChampions();
  const dataDragonChampions = await getChampionList();
  const totalChecks = registryChampions.length + dataDragonChampions.length;
  logger.info(
    `🖼️  Validating Data Dragon assets for ${String(totalChecks)} champion entries (${String(registryChampions.length)} via registry, ${String(dataDragonChampions.length)} via champion.json)`,
  );

  const failures: Error[] = [];

  for (const { id } of registryChampions) {
    const key = resolveChampionKey(id);

    try {
      await validateChampionImage(key);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      await validateChampionLoadingImage(key);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      await validateChampionSplashImage(key);
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
      await validateChampionLoadingImage(id);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }

    try {
      await validateChampionSplashImage(id);
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

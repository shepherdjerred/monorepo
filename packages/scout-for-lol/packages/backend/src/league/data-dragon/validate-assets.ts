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

/** Run one asset check, collecting any failure instead of throwing. */
async function collectFailure(
  failures: Error[],
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
  } catch (error) {
    failures.push(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Validate the square, loading, and splash images for one champion key. */
async function collectChampionAssetFailures(
  failures: Error[],
  key: string,
): Promise<void> {
  await collectFailure(failures, () => validateChampionImage(key));
  await collectFailure(failures, () => validateChampionLoadingImage(key));
  await collectFailure(failures, () => validateChampionSplashImage(key));
}

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
    await collectChampionAssetFailures(failures, resolveChampionKey(id));
  }

  for (const { id } of dataDragonChampions) {
    await collectChampionAssetFailures(failures, id);
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Missing Data Dragon champion assets (${String(failures.length)} failure${failures.length === 1 ? "" : "s"}). Run 'bun run update-data-dragon' in packages/data.`,
    );
  }

  logger.info("✅ All champion assets present");
}

import {
  validateChampionImage,
  validateChampionLoadingImage,
} from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { getAllChampions, resolveChampionKey } from "#src/utils/champion.ts";

const logger = createLogger("validate-assets");

// Crashes the pod at startup if any Data Dragon champion asset is missing
// for a champion Twisted knows about. A stale `championNameOverrides`
// generated map would otherwise surface at notification time — this moves
// the failure to deploy time so it paires with P1 (auto-generation) to
// eliminate production 404s.
export async function validateChampionAssets(): Promise<void> {
  const champions = getAllChampions();
  logger.info(
    `🖼️  Validating Data Dragon assets for ${String(champions.length)} champions`,
  );

  const failures: Error[] = [];

  for (const { id } of champions) {
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

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Missing Data Dragon champion assets (${String(failures.length)} failure${failures.length === 1 ? "" : "s"}). Run 'bun run update-data-dragon' in packages/data.`,
    );
  }

  logger.info("✅ All champion assets present");
}

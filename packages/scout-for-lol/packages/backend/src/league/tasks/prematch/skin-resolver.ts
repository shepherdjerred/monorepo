import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";
import { isSkinAvailable } from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("prematch-skin-resolver");

/**
 * Resolve the skin number for a participant from the spectator API.
 *
 * The Spectator V5 API may provide skin info through `gameCustomizationObjects`,
 * but this field is optional and its format is not well-documented.
 * Known categories observed in the wild are not consistently populated.
 *
 * Strategy:
 * 1. Check gameCustomizationObjects for skin data
 * 2. Validate the skin exists in our local cache
 * 3. Default to skin 0 (base skin) if unavailable
 *
 * @param participant - Raw participant from spectator API
 * @param championName - Resolved champion key (e.g., "Aatrox")
 * @returns Skin number to use for loading screen art
 */
export function resolveSkinNum(
  participant: RawCurrentGameParticipant,
  championName: string,
): number {
  const customizations = participant.gameCustomizationObjects;
  if (!customizations || customizations.length === 0) {
    return 0;
  }

  // Try to extract skin info from customization objects
  for (const obj of customizations) {
    // Some API versions put skin data in specific categories
    if (obj.category === "skin" || obj.category === "champion-skin") {
      const skinNum = Number.parseInt(obj.content, 10);
      if (!Number.isNaN(skinNum) && skinNum >= 0) {
        return validateSkinNum(championName, skinNum);
      }
    }

    // Try to parse content as JSON for structured skin data
    try {
      const parsed: unknown = JSON.parse(obj.content);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "skinId" in parsed
      ) {
        const record = parsed as Record<string, unknown>;
        const skinId = Number(record["skinId"]);
        if (!Number.isNaN(skinId) && skinId >= 0) {
          return validateSkinNum(championName, skinId);
        }
      }
    } catch {
      // Not JSON, try next
    }
  }

  return 0;
}

function validateSkinNum(championName: string, skinNum: number): number {
  // isSkinAvailable is async but we need sync here — use a fire-and-forget log
  // For the actual check, we optimistically return the skin num and let the
  // image cache handle fallback to default skin if the image doesn't exist
  void isSkinAvailable(championName, skinNum)
    .then((available) => {
      if (!available) {
        logger.debug(
          `Skin ${skinNum.toString()} for ${championName} not in local cache, will fall back to default`,
        );
      }
    })
    .catch(() => {
      // champion-skins.json may not exist yet; ignore gracefully
    });
  return skinNum;
}

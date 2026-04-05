import { z } from "zod";
import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";

/**
 * Schema for structured skin data in gameCustomizationObjects content.
 */
const SkinContentSchema = z.object({
  skinId: z.number(),
});

/**
 * Resolve the skin number for a participant from the spectator API.
 *
 * The Spectator V5 API may provide skin info through `gameCustomizationObjects`,
 * but this field is optional and its format is not well-documented.
 * Known categories observed in the wild are not consistently populated.
 *
 * Strategy:
 * 1. Check gameCustomizationObjects for skin data
 * 2. Default to skin 0 (base skin) if unavailable
 * 3. The image cache handles fallback to default skin at render time
 *
 * @param participant - Raw participant from spectator API
 * @param championName - Resolved champion key (e.g., "Aatrox")
 * @returns Skin number to use for loading screen art
 */
export function resolveSkinNum(
  participant: RawCurrentGameParticipant,
  _championName: string,
): number {
  const customizations = participant.gameCustomizationObjects;
  if (customizations === undefined || customizations.length === 0) {
    return 0;
  }

  // Try to extract skin info from customization objects
  for (const obj of customizations) {
    // Some API versions put skin data in specific categories
    if (obj.category === "skin" || obj.category === "champion-skin") {
      const skinNum = Number.parseInt(obj.content, 10);
      if (!Number.isNaN(skinNum) && skinNum >= 0) {
        return skinNum;
      }
    }

    // Try to parse content as JSON for structured skin data
    try {
      const parsed: unknown = JSON.parse(obj.content);
      const result = SkinContentSchema.safeParse(parsed);
      if (result.success && result.data.skinId >= 0) {
        return result.data.skinId;
      }
    } catch {
      // Not JSON, try next
    }
  }

  return 0;
}

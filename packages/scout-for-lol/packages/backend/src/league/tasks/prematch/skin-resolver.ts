import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";
import { resolveLoadingSkinNum } from "@scout-for-lol/data/index.ts";

/**
 * Resolve the skin number for a participant to one that has loading screen art.
 *
 * The Spectator V5 API provides `lastSelectedSkinIndex` which may be a chroma
 * variant (no separate loading screen image). This function resolves chromas
 * to their parent skin, ensuring we always have a valid image to render.
 *
 * @param participant - Raw participant from spectator API
 * @param championName - Resolved champion key (e.g., "Aatrox")
 * @returns Skin number that has a loading screen image on disk
 */
export async function resolveSkinNum(
  participant: RawCurrentGameParticipant,
  championName: string,
): Promise<number> {
  return resolveLoadingSkinNum(championName, participant.lastSelectedSkinIndex);
}

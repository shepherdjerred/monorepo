import type { RawCurrentGameParticipant } from "@scout-for-lol/data/index.ts";

/**
 * Resolve the skin number for a participant from the spectator API.
 *
 * The Spectator V5 API provides `lastSelectedSkinIndex` directly on each
 * participant, which corresponds to the skin's `num` field in Data Dragon
 * champion data.
 *
 * @param participant - Raw participant from spectator API
 * @returns Skin number to use for loading screen art (0 = default)
 */
export function resolveSkinNum(
  participant: RawCurrentGameParticipant,
): number {
  return participant.lastSelectedSkinIndex;
}

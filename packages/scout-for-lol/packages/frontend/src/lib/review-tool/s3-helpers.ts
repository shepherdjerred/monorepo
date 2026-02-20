/**
 * Helper functions for S3 match conversion
 */
import type { RawParticipant, Rune, Champion } from "@scout-for-lol/data";
import { getRuneInfo, parseLane } from "@scout-for-lol/data";

/**
 * Get match outcome from participant data
 * Mirrors backend implementation from packages/backend/src/league/model/match.ts
 */
export function getOutcome(
  participant: RawParticipant,
): "Victory" | "Defeat" | "Surrender" {
  if (participant.win) {
    return "Victory";
  }
  if (participant.gameEndedInSurrender) {
    return "Surrender";
  }
  return "Defeat";
}

/**
 * Extract rune details from participant perks
 */
function extractRunes(p: RawParticipant): Rune[] {
  const runes: Rune[] = [];

  // Extract primary rune selections
  const primaryStyle = p.perks.styles[0];
  if (primaryStyle) {
    for (const selection of primaryStyle.selections) {
      const info = getRuneInfo(selection.perk);
      runes.push({
        id: selection.perk,
        name: info?.name ?? `Rune ${selection.perk.toString()}`,
        description: info?.longDesc ?? info?.shortDesc ?? "",
      });
    }
  }

  // Extract secondary rune selections
  const subStyle = p.perks.styles[1];
  if (subStyle) {
    for (const selection of subStyle.selections) {
      const info = getRuneInfo(selection.perk);
      runes.push({
        id: selection.perk,
        name: info?.name ?? `Rune ${selection.perk.toString()}`,
        description: info?.longDesc ?? info?.shortDesc ?? "",
      });
    }
  }

  return runes;
}

/**
 * Convert raw participant to champion (like backend does)
 */
export function participantToChampion(p: RawParticipant): Champion {
  const riotIdGameName =
    p.riotIdGameName !== undefined &&
    p.riotIdGameName.length > 0 &&
    p.riotIdTagline
      ? p.riotIdGameName
      : "Unknown";

  return {
    riotIdGameName,
    championName: p.championName,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    level: p.champLevel,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
    lane: parseLane(p.teamPosition),
    spells: [p.summoner1Id, p.summoner2Id],
    gold: p.goldEarned,
    runes: extractRunes(p),
    creepScore: p.totalMinionsKilled + p.neutralMinionsKilled,
    visionScore: p.visionScore,
    damage: p.totalDamageDealtToChampions,
  };
}

/**
 * Valid match key pattern: games/YYYY/MM/DD/{MATCH_ID}/match.json
 * Match ID examples: NA1_1234567890, EUW1_9876543210_TEST, etc.
 */
const VALID_MATCH_KEY_REGEX =
  /^games\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/match\.json$/;

/**
 * Check if an S3 key represents a valid match file
 * This prevents fetching non-match files (directories, temp files, etc.)
 */
export function isValidMatchKey(key: string): boolean {
  return VALID_MATCH_KEY_REGEX.test(key);
}

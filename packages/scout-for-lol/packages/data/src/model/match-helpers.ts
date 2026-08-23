import { filter, first, map, pipe } from "remeda";
import { match } from "ts-pattern";
import type { RawParticipant } from "#src/league/raw-participant.schema.ts";
import type { Champion, Rune } from "#src/model/champion.ts";
import { normalizeChampionName } from "#src/model/champion-registry.ts";
import { getRuneInfo } from "#src/data-dragon/runes.ts";
import { parseLane } from "#src/model/lane.ts";
import { type Team, parseTeam } from "#src/model/team.ts";

/**
 * Finds a participant in a match by their PUUID
 */
export function findParticipant(
  puuid: string,
  participants: RawParticipant[],
): RawParticipant | undefined {
  return pipe(
    participants,
    filter((participant) => participant.puuid === puuid),
    first(),
  );
}

/**
 * Determines the outcome of a match for a participant
 */
export function getOutcome(
  participant: RawParticipant,
): "Victory" | "Surrender" | "Defeat" {
  return match(participant)
    .returnType<"Victory" | "Surrender" | "Defeat">()
    .with({ win: true }, () => "Victory")
    .with({ gameEndedInSurrender: true }, () => "Surrender")
    .with({ win: false }, () => "Defeat")
    .exhaustive();
}

/**
 * Helper to extract runes from a single rune style
 */
function extractRunesFromStyle(
  style: RawParticipant["perks"]["styles"][number] | undefined,
): Rune[] {
  const runes: Rune[] = [];
  if (!style) {
    return runes;
  }

  for (const selection of style.selections) {
    const info = getRuneInfo(selection.perk);
    runes.push({
      id: selection.perk,
      name: info?.name ?? `Rune ${selection.perk.toString()}`,
      description: info?.longDesc ?? info?.shortDesc ?? "",
    });
  }

  return runes;
}

/**
 * Helper to extract rune details from participant perks
 */
export function extractRunes(participant: RawParticipant): Rune[] {
  const runes: Rune[] = [];

  // Extract primary rune selections
  const primaryStyle = participant.perks.styles[0];
  runes.push(...extractRunesFromStyle(primaryStyle));

  // Extract secondary rune selections
  const subStyle = participant.perks.styles[1];
  runes.push(...extractRunesFromStyle(subStyle));

  return runes;
}

/**
 * Converts a raw participant to a Champion object with full details including runes.
 */
export function participantToChampion(participant: RawParticipant): Champion {
  return {
    riotIdGameName:
      participant.riotIdGameName !== undefined &&
      participant.riotIdGameName.length > 0 &&
      participant.riotIdGameName.length > 0
        ? participant.riotIdGameName
        : "Unknown",
    championName: normalizeChampionName(participant.championName),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    level: participant.champLevel,
    items: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6,
    ],
    spells: [participant.summoner1Id, participant.summoner2Id],
    gold: participant.goldEarned,
    runes: extractRunes(participant),
    creepScore:
      participant.totalMinionsKilled + participant.neutralMinionsKilled,
    visionScore: participant.visionScore,
    damage: participant.totalDamageDealtToChampions,
    lane: parseLane(participant.teamPosition),
  };
}

/**
 * Splits participants into blue and red teams by `teamId`.
 *
 * Deliberately not `slice(0, 5)` / `slice(5, 10)`: that only holds for a full
 * 5v5 emitted blue-then-red, so a tournament-code custom of any other size split
 * into nonsense teams. Grouping also removes the dependency on Riot's ordering,
 * which was never a documented guarantee.
 *
 * A participant whose `teamId` is neither 100 nor 200 is dropped. That is not a
 * silent fallback — `RosterSchema` requires at least one champion per side, so a
 * payload we cannot classify fails loudly at `CompletedMatchSchema.parse`
 * instead of producing a half-empty report.
 */
export function getTeams<T>(
  participants: RawParticipant[],
  championConverter: (p: RawParticipant) => T,
) {
  const forTeam = (team: Team) =>
    pipe(
      participants,
      filter((participant) => parseTeam(participant.teamId) === team),
      map(championConverter),
    );
  return {
    blue: forTeam("blue"),
    red: forTeam("red"),
  };
}

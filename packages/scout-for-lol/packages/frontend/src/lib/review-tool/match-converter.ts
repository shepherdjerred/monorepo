/**
 * Match conversion utilities for transforming Riot API data to internal format
 */
import {
  parseQueueType,
  getLaneOpponent,
  parseTeam,
  invertTeam,
  getOrdinalSuffix,
  parseLane,
  type RawMatch,
  type ArenaMatch,
  type CompletedMatch,
} from "@scout-for-lol/data";
import { getExampleMatch } from "@scout-for-lol/data";
import { getOutcome, participantToChampion } from "./s3-helpers.ts";

/**
 * Get the base example match structure for a given queue type
 */
function getBaseMatch(
  queueType: ReturnType<typeof parseQueueType>,
): CompletedMatch | ArenaMatch {
  switch (queueType) {
    case "arena":
      return getExampleMatch("arena");
    case "aram":
      return getExampleMatch("aram");
    case "solo":
    case "flex":
      return getExampleMatch("ranked");
    case "clash":
    case "aram clash":
    case "arurf":
    case "urf":
    case "quickplay":
    case "swiftplay":
    case "brawl":
    case "draft pick":
    case "easy doom bots":
    case "normal doom bots":
    case "hard doom bots":
    case "custom":
    case undefined:
      return getExampleMatch("unranked");
  }
}

/**
 * Build a Riot ID string from participant data
 */
function buildRiotId(
  participant: RawMatch["info"]["participants"][number],
  fallback: string,
): string {
  return participant.riotIdGameName !== undefined &&
    participant.riotIdGameName.length > 0 &&
    participant.riotIdTagline
    ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
    : fallback;
}

/**
 * Reorder participants so that the selected player appears first
 */
function reorderParticipants(
  participants: RawMatch["info"]["participants"],
  selectedPlayerName: string | undefined,
): RawMatch["info"]["participants"] {
  if (selectedPlayerName === undefined || selectedPlayerName.length === 0) {
    return [...participants];
  }

  const result = [...participants];
  const selectedIndex = result.findIndex((p) => {
    const riotId = buildRiotId(p, "Unknown");
    return riotId === selectedPlayerName;
  });

  if (selectedIndex > 0) {
    const selectedPlayer = result[selectedIndex];
    if (selectedPlayer) {
      return [selectedPlayer, ...result.filter((_, i) => i !== selectedIndex)];
    }
  }

  return result;
}

/**
 * Convert a Riot API match to our internal format
 * This is a simplified conversion for dev tool purposes - we use example match structure
 * but populate it with real player data including Riot IDs
 * @param rawMatch - The raw Riot API match data
 * @param selectedPlayerName - The Riot ID (GameName#Tagline) of the player to prioritize as first player
 */
export function convertRawMatchToInternalFormat(
  rawMatch: RawMatch,
  selectedPlayerName?: string,
): CompletedMatch | ArenaMatch {
  const queueType = parseQueueType(rawMatch.info.queueId);
  const baseMatch = getBaseMatch(queueType);
  const reorderedParticipants = reorderParticipants(
    rawMatch.info.participants,
    selectedPlayerName,
  );

  // Build team rosters first (needed for lane opponent calculation)
  const teams = {
    blue: rawMatch.info.participants
      .filter((p) => p.teamId === 100)
      .map((p) => participantToChampion(p)),
    red: rawMatch.info.participants
      .filter((p) => p.teamId === 200)
      .map((p) => participantToChampion(p)),
  };

  // Update players with real data from the match - split by queue type for proper typing
  if (baseMatch.queueType === "arena") {
    const arenaMatch: ArenaMatch = baseMatch;
    const updatedPlayers = arenaMatch.players.map((player, index) => {
      const participant = reorderedParticipants[index];
      if (!participant) {
        return player;
      }
      return {
        ...player,
        playerConfig: {
          ...player.playerConfig,
          alias: buildRiotId(participant, player.playerConfig.alias),
        },
        champion: {
          ...player.champion,
          championName: participant.championName,
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
        },
      };
    });

    return {
      ...arenaMatch,
      players: updatedPlayers,
      durationInSeconds: rawMatch.info.gameDuration,
    };
  }

  // For regular matches, convert participant to full champion and calculate lane opponent
  const completedMatch = baseMatch;
  const updatedPlayers = completedMatch.players.map((player, index) => {
    const participant = reorderedParticipants[index];
    if (!participant) {
      return player;
    }

    const champion = participantToChampion(participant);
    const team = parseTeam(participant.teamId);
    if (!team) {
      console.warn(
        `Invalid teamId ${participant.teamId.toString()} for participant`,
      );
      return player;
    }
    const enemyTeam = invertTeam(team);
    const laneOpponent = getLaneOpponent(champion, teams[enemyTeam]);
    const outcome = getOutcome(participant);

    return {
      ...player,
      playerConfig: {
        ...player.playerConfig,
        alias: buildRiotId(participant, player.playerConfig.alias),
      },
      champion,
      lane: champion.lane,
      laneOpponent,
      outcome,
      team,
    };
  });

  return {
    ...completedMatch,
    players: updatedPlayers,
    durationInSeconds: rawMatch.info.gameDuration,
    teams,
  };
}

/**
 * Match metadata for display
 */
export type MatchMetadata = {
  key: string;
  queueType: string;
  playerName: string;
  champion: string;
  lane: string;
  outcome: string;
  kda: string;
  timestamp: Date;
};

/**
 * Extract metadata for all participants from a raw Riot API match
 */
export function extractMatchMetadataFromRawMatch(
  rawMatch: RawMatch,
  key: string,
): MatchMetadata[] {
  const queueType = parseQueueType(rawMatch.info.queueId);
  const timestamp = new Date(rawMatch.info.gameEndTimestamp);

  return rawMatch.info.participants.map((participant) => {
    // Build Riot ID (GameName#Tagline)
    const riotId =
      participant.riotIdGameName !== undefined &&
      participant.riotIdGameName.length > 0 &&
      participant.riotIdTagline
        ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
        : "Unknown";

    // Determine outcome
    let outcome: string;
    if (queueType === "arena") {
      const placement = participant.placement;
      outcome =
        placement === undefined
          ? "Unknown"
          : `${String(placement)}${getOrdinalSuffix(placement)} place`;
    } else {
      outcome = participant.win ? "Victory" : "Defeat";
    }

    // Parse lane
    const lane = parseLane(participant.teamPosition);

    const laneStr = lane ?? "unknown";
    return {
      key,
      queueType: queueType ?? "unknown",
      playerName: riotId,
      champion: participant.championName,
      lane: laneStr,
      outcome,
      kda: `${String(participant.kills)}/${String(participant.deaths)}/${String(participant.assists)}`,
      timestamp,
    };
  });
}

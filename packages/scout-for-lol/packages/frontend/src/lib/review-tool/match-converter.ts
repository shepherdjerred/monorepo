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

  // Get base example match structure
  let baseMatch: CompletedMatch | ArenaMatch;
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- unhandled queue types fall through to default (unranked)
  switch (queueType) {
  case "arena": {
    baseMatch = getExampleMatch("arena");
  
  break;
  }
  case "aram": {
    baseMatch = getExampleMatch("aram");
  
  break;
  }
  case "solo": 
  case "flex": {
    baseMatch = getExampleMatch("ranked");
  
  break;
  }
  default: {
    baseMatch = getExampleMatch("unranked");
  }
  }

  // Reorder participants so selected player is first
  let reorderedParticipants = [...rawMatch.info.participants];
  if (selectedPlayerName !== undefined && selectedPlayerName.length > 0) {
    const selectedIndex = reorderedParticipants.findIndex((p) => {
      const riotId =
        p.riotIdGameName !== undefined && p.riotIdGameName.length > 0 && p.riotIdTagline
          ? `${p.riotIdGameName}#${p.riotIdTagline}`
          : "Unknown";
      return riotId === selectedPlayerName;
    });

    if (selectedIndex !== -1 && selectedIndex !== 0) {
      // Move selected player to first position
      const selectedPlayer = reorderedParticipants[selectedIndex];
      if (selectedPlayer) {
        reorderedParticipants = [
          selectedPlayer,
          ...reorderedParticipants.filter((_, i) => i !== selectedIndex),
        ];
      }
    }
  }

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
      if (participant) {
        // Build Riot ID (GameName#Tagline)
        const riotId =
          participant.riotIdGameName !== undefined && participant.riotIdGameName.length > 0 && participant.riotIdTagline
            ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
            : player.playerConfig.alias;

        return {
          ...player,
          playerConfig: {
            ...player.playerConfig,
            alias: riotId,
          },
          champion: {
            ...player.champion,
            championName: participant.championName,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
          },
        };
      }
      return player;
    });

    // For arena matches, no teams roster
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
    if (participant) {
      // Build Riot ID (GameName#Tagline)
      const riotId =
        participant.riotIdGameName !== undefined && participant.riotIdGameName.length > 0 && participant.riotIdTagline
          ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
          : player.playerConfig.alias;

      const champion = participantToChampion(participant);
      const team = parseTeam(participant.teamId);
      // Team should always be defined for valid matches (teamId is 100 or 200)
      if (!team) {
        console.warn(
          `Invalid teamId ${participant.teamId.toString()} for participant`,
        );
        return player; // Keep original player if team is invalid
      }
      const enemyTeam = invertTeam(team);
      const laneOpponent = getLaneOpponent(champion, teams[enemyTeam]);
      const outcome = getOutcome(participant);

      // For regular matches, include lane, lane opponent, outcome, and team
      return {
        ...player,
        playerConfig: {
          ...player.playerConfig,
          alias: riotId,
        },
        champion,
        lane: champion.lane,
        laneOpponent,
        outcome,
        team,
      };
    }
    return player;
  });

  // Return completed match with updated players
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
      participant.riotIdGameName !== undefined && participant.riotIdGameName.length > 0 && participant.riotIdTagline
        ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
        : "Unknown";

    // Determine outcome
    let outcome: string;
    if (queueType === "arena") {
      const placement = participant.placement;
      outcome = placement === undefined ? "Unknown" : `${String(placement)}${getOrdinalSuffix(placement)} place`;
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

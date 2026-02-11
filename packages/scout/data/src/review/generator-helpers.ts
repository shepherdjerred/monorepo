import { match as matchPattern } from "ts-pattern";
import type { ArenaMatch, CompletedMatch } from "@shepherdjerred/scout-data/model/index.ts";
import { selectRandomBehaviors, type Personality } from "@shepherdjerred/scout-data/review/prompts.ts";
import { wasPromoted, wasDemoted, rankToSimpleString, tierToPercentileString } from "@shepherdjerred/scout-data/model/rank.ts";
import { lpDiffToString, rankToLeaguePoints } from "@shepherdjerred/scout-data/model/league-points.ts";

/**
 * Extract match data from a match object
 * Handles both arena and regular matches
 * @param match - The completed match data
 * @param playerIndex - Optional index of the player to extract data for (defaults to 0)
 */
export function extractMatchData(
  match: CompletedMatch | ArenaMatch,
  playerIndex = 0,
): {
  matchData: Record<string, string>;
  lane: string | undefined;
} {
  return matchPattern(match)
    .with({ queueType: "arena" }, (arenaMatch: ArenaMatch) => {
      const player = arenaMatch.players[playerIndex] ?? arenaMatch.players[0];
      if (!player) {
        throw new Error("No player data found");
      }

      const placement = player.placement;
      const kills = player.champion.kills;
      const deaths = player.champion.deaths;
      const assists = player.champion.assists;

      return {
        lane: undefined,
        matchData: {
          playerName: player.playerConfig.alias,
          champion: player.champion.championName,
          lane: "arena",
          outcome: `${placement.toString()}${getOrdinalSuffix(placement)} place`,
          kda: `${kills.toString()}/${deaths.toString()}/${assists.toString()}`,
          queueType: arenaMatch.queueType,
          teammate: player.teammate.championName,
        },
      };
    })
    .otherwise((regularMatch: CompletedMatch) => {
      const player = regularMatch.players[playerIndex] ?? regularMatch.players[0];
      if (!player) {
        throw new Error("No player data found");
      }

      const kills = player.champion.kills;
      const deaths = player.champion.deaths;
      const assists = player.champion.assists;

      const data: Record<string, string> = {
        playerName: player.playerConfig.alias,
        champion: player.champion.championName,
        lane: player.lane ?? "unknown",
        outcome: player.outcome,
        kda: `${kills.toString()}/${deaths.toString()}/${assists.toString()}`,
        queueType: regularMatch.queueType ?? "unknown",
      };

      // Add lane opponent if available
      if (player.laneOpponent) {
        data["laneOpponent"] = player.laneOpponent.championName;
      }

      return {
        lane: player.lane,
        matchData: data,
      };
    });
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
export function getOrdinalSuffix(num: number): string {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return "th";
  }

  switch (lastDigit) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Build context about other tracked players (friends) in the match
 * @param match - The completed match data
 * @param playerIndex - Index of the player being reviewed (to exclude from friends list)
 * @returns A formatted string describing friends in the match, or empty string if none
 */
function buildFriendsContext(match: CompletedMatch | ArenaMatch, playerIndex: number): string {
  const allPlayers = match.players;
  const totalTrackedPlayers = allPlayers.length;
  const friends = allPlayers.filter((_, index) => index !== playerIndex);
  const queueType = match.queueType;

  // Handle special flex queue cases
  if (queueType === "flex") {
    return buildFlexQueueContext(friends, totalTrackedPlayers);
  }

  // Handle solo/duo queue case
  if (queueType === "solo" && totalTrackedPlayers === 2 && friends.length === 1) {
    const duoPartner = friends[0];
    if (duoPartner) {
      const alias = duoPartner.playerConfig.alias;
      const champion = duoPartner.champion.championName;
      const lane = "lane" in duoPartner && duoPartner.lane ? ` in ${duoPartner.lane}` : "";
      return `This is a duo queue game. Their duo partner is ${alias} (playing ${champion}${lane}).`;
    }
  }

  if (friends.length === 0) {
    return "";
  }

  const friendDescriptions = friends.map((friend) => {
    const alias = friend.playerConfig.alias;
    const champion = friend.champion.championName;

    if (match.queueType === "arena") {
      return `${alias} (playing ${champion})`;
    }

    // For regular matches, include lane if available
    const lane = "lane" in friend && friend.lane ? ` in ${friend.lane}` : "";
    return `${alias} (playing ${champion}${lane})`;
  });

  if (friends.length === 1 && friendDescriptions[0]) {
    return `Their friend ${friendDescriptions[0]} was also in this match.`;
  }

  const lastFriend = friendDescriptions.pop();
  if (!lastFriend) {
    return "";
  }
  return `Their friends ${friendDescriptions.join(", ")} and ${lastFriend} were also in this match.`;
}

/**
 * Build context for flex queue matches with special messaging based on party size
 */
function buildFlexQueueContext(
  friends: { playerConfig: { alias: string }; champion: { championName: string }; lane?: string | undefined }[],
  totalTrackedPlayers: number,
): string {
  const friendDescriptions = friends.map((friend) => {
    const alias = friend.playerConfig.alias;
    const champion = friend.champion.championName;
    const lane = "lane" in friend && friend.lane ? ` in ${friend.lane}` : "";
    return `${alias} (playing ${champion}${lane})`;
  });

  // Solo queuing for flex (unusual behavior)
  if (totalTrackedPlayers === 1) {
    return "This player queued for flex queue alone, which is unusual. Most people queue flex with friends.";
  }

  // Full premade team (5 players)
  if (totalTrackedPlayers === 5) {
    const lastFriend = friendDescriptions.pop();
    if (!lastFriend) {
      return "";
    }
    if (friendDescriptions.length === 0) {
      return `This is a full 5-player premade team. Their teammate is ${lastFriend}.`;
    }
    return `This is a full 5-player premade team. Their teammates are ${friendDescriptions.join(", ")} and ${lastFriend}.`;
  }

  // 4 friends (likely 4-stack with 1 random)
  if (totalTrackedPlayers === 4) {
    const lastFriend = friendDescriptions.pop();
    if (!lastFriend) {
      return "";
    }
    if (friendDescriptions.length === 0) {
      return `This is a 4-player premade group with one random matchmade player. Their teammates are ${lastFriend}.`;
    }
    return `This is a 4-player premade group with one random matchmade player. Their teammates are ${friendDescriptions.join(", ")} and ${lastFriend}.`;
  }

  // Other flex cases (2-3 players)
  if (friends.length === 0) {
    return "";
  }

  if (friends.length === 1 && friendDescriptions[0]) {
    return `Their friend ${friendDescriptions[0]} was also in this flex queue match.`;
  }

  const lastFriend = friendDescriptions.pop();
  if (!lastFriend) {
    return "";
  }
  return `Their friends ${friendDescriptions.join(", ")} and ${lastFriend} were also in this flex queue match.`;
}

/**
 * Build queue context text based on the queue type
 * Provides context about the game mode to help the AI understand the stakes and setting
 */
function buildQueueContext(queueType: string | undefined): string {
  switch (queueType) {
    case "solo":
      return "This is a Solo/Duo Ranked game - the most competitive standard queue where players climb the ranked ladder. Games are taken seriously and LP is on the line.";
    case "flex":
      return "This is a Flex Ranked game - a ranked queue that allows groups of any size. Generally more relaxed than Solo/Duo but still competitive since LP is on the line.";
    case "clash":
      return "This is a CLASH game - a competitive tournament mode where teams sign up in advance and play bracket-style matches. Clash games are typically more serious and strategic than regular games, with coordinated team compositions and communication. The stakes feel higher and players often try harder.";
    case "aram clash":
      return "This is an ARAM CLASH game - a competitive ARAM tournament where teams play All Random All Mid in bracket-style matches. Like regular Clash, these games are more competitive and coordinated than normal ARAM games, with players taking the random champion assignments more seriously.";
    case "arena":
      return "This is an Arena game - a 2v2v2v2 round-based mode where four teams fight to survive. Players pick augments between rounds and the last team standing wins.";
    case "aram":
      return "This is an ARAM game - All Random All Mid on the Howling Abyss. Players get random champions and fight in a single lane. It's a more casual, chaotic mode focused on teamfighting.";
    case "normal":
      return "This is a Normal (unranked) game - a casual queue for practicing or playing without ranked pressure.";
    case undefined:
    default:
      return "This is a standard League of Legends game.";
  }
}

/**
 * Build rank context describing promotions/demotions for tracked players
 * @param match - The completed match data
 * @returns A formatted string describing rank changes, or empty string if none
 */
function buildRankContext(match: CompletedMatch | ArenaMatch): string {
  // Arena matches don't have rank changes
  if (match.queueType === "arena") {
    return "";
  }

  const rankInfo: string[] = [];

  for (const player of match.players) {
    const rankBefore = player.rankBeforeMatch;
    const rankAfter = player.rankAfterMatch;
    const playerName = player.playerConfig.alias;

    if (!rankAfter) {
      continue;
    }

    // Add current rank with percentile context
    const rankStr = rankToSimpleString(rankAfter);
    const percentileStr = tierToPercentileString(rankAfter.tier);
    const rankLine = `${playerName} is currently ${rankStr} (${percentileStr} of players).`;

    if (wasPromoted(rankBefore, rankAfter)) {
      rankInfo.push(`${rankLine} They were PROMOTED after this game!`);
    } else if (wasDemoted(rankBefore, rankAfter)) {
      rankInfo.push(`${rankLine} They were DEMOTED after this game.`);
    } else if (rankBefore) {
      // Show LP change for non-promotion/demotion games
      const lpDelta = rankToLeaguePoints(rankAfter) - rankToLeaguePoints(rankBefore);
      if (lpDelta !== 0) {
        const lpStr = lpDiffToString(lpDelta);
        const changeStr = lpDelta > 0 ? `gained ${lpStr.replace(/[+-]/, "")}` : `lost ${lpStr.replace(/[+-]/, "")}`;
        rankInfo.push(`${rankLine} They ${changeStr}.`);
      } else {
        rankInfo.push(rankLine);
      }
    } else {
      rankInfo.push(rankLine);
    }
  }

  if (rankInfo.length === 0) {
    return "";
  }

  return rankInfo.join(" ");
}

export function buildPromptVariables(params: {
  matchData: Record<string, string>;
  personality: Personality;
  laneContext: string;
  match: CompletedMatch | ArenaMatch;
  playerIndex?: number;
  matchAnalysis?: string;
  timelineSummary?: string;
}): {
  reviewerName: string;
  playerName: string;
  playerChampion: string;
  playerLane: string;
  opponentChampion: string;
  laneDescription: string;
  matchReport: string;
  friendsContext: string;
  randomBehavior: string;
  matchAnalysis: string;
  timelineSummary: string;
  queueContext: string;
  rankContext: string;
} {
  const { matchData, personality, laneContext, match, playerIndex = 0, matchAnalysis, timelineSummary } = params;
  const playerName = matchData["playerName"];
  if (!playerName) {
    throw new Error("No player name found");
  }

  const reviewerName = personality.metadata.name;

  const playerChampion = matchData["champion"] ?? "unknown champion";
  const playerLane = matchData["lane"] ?? "unknown lane";
  const opponentChampion = matchData["laneOpponent"] ?? "an unknown opponent";
  const laneDescription = laneContext;

  // Minify JSON to save tokens
  const matchReport = JSON.stringify(match);

  const friendsContext = buildFriendsContext(match, playerIndex);

  // Select 3-6 random behaviors based on personality weights
  const randomBehavior = selectRandomBehaviors(personality.metadata.randomBehaviors);
  const matchAnalysisText =
    matchAnalysis && matchAnalysis.trim().length > 0
      ? matchAnalysis.trim()
      : "No AI match analysis was generated for this match.";
  const timelineSummaryText =
    timelineSummary && timelineSummary.trim().length > 0
      ? timelineSummary.trim()
      : "No timeline summary available for this match.";

  const queueContext = buildQueueContext(match.queueType);
  const rankContext = buildRankContext(match);

  return {
    reviewerName,
    playerName,
    playerChampion,
    playerLane,
    opponentChampion,
    laneDescription,
    matchReport,
    friendsContext,
    randomBehavior,
    matchAnalysis: matchAnalysisText,
    timelineSummary: timelineSummaryText,
    queueContext,
    rankContext,
  };
}

import { createLogger } from "@scout-for-lol/backend/logger.ts";
import { MY_SERVER } from "@scout-for-lol/backend/configuration/flags.ts";
import { send as sendChannelMessage } from "@scout-for-lol/backend/league/discord/channel.ts";
import { splitMessageIntoChunks } from "@scout-for-lol/backend/discord/utils/message.ts";
import {
  type ServerPairingStats,
  type PairingStatsEntry,
  DiscordChannelIdSchema,
} from "@scout-for-lol/data/index";
import {
  getServerPlayers,
  createAliasToDiscordIdMap,
} from "./get-server-players.ts";
import { getCurrentWeekInfo } from "./s3-cache.ts";
import {
  findSurrenderLeaders,
  calculateAllModeStats,
} from "./weekly-update-helpers.ts";
import {
  startTask,
  finishTask,
  isRunning,
  getTaskInfo,
} from "./pairing-task-state.ts";
import { subWeeks, startOfISOWeek, endOfISOWeek } from "date-fns";
import * as Sentry from "@sentry/bun";

// Channel ID for Common Denominator updates
const COMMON_DENOMINATOR_CHANNEL_ID = DiscordChannelIdSchema.parse(
  "1337631455085334650",
);

const logger = createLogger("pairing-weekly-update");

// Minimum games required for a pairing to be included in rankings
const MIN_GAMES_FOR_RANKING = 10;

// For full leaderboard, show top N and bottom N
const LEADERBOARD_TOP_BOTTOM_COUNT = 25;

/**
 * Format win rate as percentage string
 */
function formatWinRate(winRate: number): string {
  return `${(winRate * 100).toFixed(1)}%`;
}

/**
 * Get medal emoji for ranking position
 */
function getMedal(rank: number): string {
  if (rank === 1) {
    return "🥇";
  }
  if (rank === 2) {
    return "🥈";
  }
  if (rank === 3) {
    return "🥉";
  }
  return "";
}

/**
 * Get pairings that meet the minimum games requirement for ranking
 */
function getQualifiedPairings(
  pairings: PairingStatsEntry[],
): PairingStatsEntry[] {
  return pairings
    .filter(
      (p) => p.totalGames >= MIN_GAMES_FOR_RANKING && p.players.length >= 2,
    )
    .toSorted((a, b) => b.winRate - a.winRate);
}

type FormatTop3EntryOptions = {
  entry: PairingStatsEntry;
  rank: number;
  aliasToDiscordId: Map<string, string>;
  useMentions: boolean;
  showGamesCount: boolean;
};

/**
 * Format a top-3 pairing entry line
 */
function formatTop3Entry(options: FormatTop3EntryOptions): string {
  const { entry, rank, aliasToDiscordId, useMentions, showGamesCount } =
    options;
  const medal = getMedal(rank);
  if (showGamesCount) {
    return `${medal} ${rank.toString()}. ${formatPairing(entry, aliasToDiscordId, useMentions)} - ${formatWinRate(entry.winRate)} (${entry.totalGames.toString()} games)`;
  }
  return `${medal} ${rank.toString()}. **${formatPairing(entry, aliasToDiscordId, useMentions)}** - ${entry.totalGames.toString()} games (${formatWinRate(entry.winRate)})`;
}

/**
 * Format pairing for display with optional Discord mentions
 * @param entry - The pairing stats entry
 * @param aliasToDiscordId - Map of alias to Discord ID for mentions
 * @param useMentions - Whether to use @mentions (defaults to true)
 */
function formatPairing(
  entry: PairingStatsEntry,
  aliasToDiscordId: Map<string, string>,
  useMentions = true,
): string {
  const formattedPlayers = [...entry.players].toSorted().map((alias) => {
    if (useMentions) {
      const discordId = aliasToDiscordId.get(alias);
      if (discordId !== undefined && discordId.length > 0) {
        return `<@${discordId}>`;
      }
    }
    return alias;
  });
  return formattedPlayers.join(" + ");
}

/**
 * Format surrender rate as percentage
 */
function formatSurrenderRate(surrenders: number, totalGames: number): string {
  if (totalGames === 0) {
    return "0%";
  }
  const rate = (surrenders / totalGames) * 100;
  return `${rate.toFixed(1)}%`;
}

/**
 * Generate the ranked (Solo/Flex) section of the message
 */
function generateRankedSection(
  stats: ServerPairingStats,
  aliasToDiscordId: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push("## Ranked (Solo/Flex)");
  lines.push("");

  // Find the player(s) with highest surrender rate (min 10 games) - show percentage and count
  const surrenderLeaders = findSurrenderLeaders(stats.individualStats);
  if (surrenderLeaders.length > 0) {
    const surrenderList = surrenderLeaders
      .map(
        (p) =>
          `**${p.alias}** (${formatSurrenderRate(p.surrenders, p.totalGames)}, ${p.surrenders.toString()} surrenders)`,
      )
      .join(", ");
    lines.push(`Highest Surrender Rate: ${surrenderList}`);
    lines.push("");
  }

  // Get pairings with enough games, sorted by win rate
  const qualifiedPairings = getQualifiedPairings(stats.pairings);

  if (qualifiedPairings.length === 0) {
    lines.push(
      `*Not enough games played together to calculate pairings (minimum ${MIN_GAMES_FOR_RANKING.toString()} games required)*`,
    );
    return lines.join("\n");
  }

  // Most Games Together (top 3)
  lines.push("### Most Games Together");
  const mostGamesPairings = [...qualifiedPairings]
    .toSorted((a, b) => b.totalGames - a.totalGames)
    .slice(0, 3);
  mostGamesPairings.forEach((entry, index) => {
    const rank = index + 1;
    lines.push(
      formatTop3Entry({
        entry,
        rank,
        aliasToDiscordId,
        useMentions: false,
        showGamesCount: false,
      }),
    );
  });

  lines.push("");

  // Full Leaderboard - top 25 and bottom 25
  lines.push("### Full Leaderboard");

  const topPairings = qualifiedPairings.slice(0, LEADERBOARD_TOP_BOTTOM_COUNT);
  const bottomPairings = qualifiedPairings.slice(-LEADERBOARD_TOP_BOTTOM_COUNT);

  // Top entries with @mentions for top 3
  topPairings.forEach((entry, index) => {
    const rank = index + 1;
    const useMentions = rank <= 3;
    const medal = getMedal(rank);
    const prefix = medal ? `${medal} ` : "";
    lines.push(
      `${prefix}${rank.toString()}. ${formatPairing(entry, aliasToDiscordId, useMentions)} - ${formatWinRate(entry.winRate)} (W: ${entry.wins.toString()}, L: ${entry.losses.toString()})`,
    );
  });

  // Add separator if there are more pairings between top and bottom
  const middleCount =
    qualifiedPairings.length - LEADERBOARD_TOP_BOTTOM_COUNT * 2;
  if (middleCount > 0) {
    lines.push(`...${middleCount.toString()} more pairings...`);
  }

  // Bottom entries (if different from top) with @mentions for bottom 3
  if (qualifiedPairings.length > LEADERBOARD_TOP_BOTTOM_COUNT) {
    const bottomStartRank =
      qualifiedPairings.length - bottomPairings.length + 1;
    bottomPairings.forEach((entry, index) => {
      const rank = bottomStartRank + index;
      const isBottom3 = index >= bottomPairings.length - 3;
      lines.push(
        `${rank.toString()}. ${formatPairing(entry, aliasToDiscordId, isBottom3)} - ${formatWinRate(entry.winRate)} (W: ${entry.wins.toString()}, L: ${entry.losses.toString()})`,
      );
    });
  }

  lines.push("");
  lines.push(
    `*Based on ${stats.totalMatchesAnalyzed.toString()} ranked games from the past month. Pairings require ${MIN_GAMES_FOR_RANKING.toString()}+ games to be ranked.*`,
  );

  return lines.join("\n");
}

/**
 * Generate an abbreviated section for Arena or ARAM (top 3 + bottom 3 only)
 */
function generateAbbreviatedSection(
  stats: ServerPairingStats,
  aliasToDiscordId: Map<string, string>,
  gameMode: "Arena" | "ARAM",
): string {
  const lines: string[] = [];

  lines.push(`## ${gameMode}`);
  lines.push("");

  // Get pairings with enough games, sorted by win rate
  const qualifiedPairings = getQualifiedPairings(stats.pairings);

  if (qualifiedPairings.length === 0) {
    lines.push(
      `*Not enough games played together (minimum ${MIN_GAMES_FOR_RANKING.toString()} games required)*`,
    );
    return lines.join("\n");
  }

  // Top 3 pairings with @mentions
  lines.push("### Best Pairings");
  const topPairings = qualifiedPairings.slice(0, 3);
  topPairings.forEach((entry, index) => {
    const rank = index + 1;
    lines.push(
      formatTop3Entry({
        entry,
        rank,
        aliasToDiscordId,
        useMentions: true,
        showGamesCount: true,
      }),
    );
  });

  lines.push("");

  // Bottom 3 pairings with @mentions
  lines.push("### Worst Pairings");
  const bottomPairings = qualifiedPairings.slice(-3).reverse();
  // Start rank = total entries - bottom count + 1, then increment by index
  const bottomStartRank = qualifiedPairings.length - bottomPairings.length + 1;
  bottomPairings.forEach((entry, index) => {
    const rank = bottomStartRank + index;
    lines.push(
      `${rank.toString()}. ${formatPairing(entry, aliasToDiscordId, true)} - ${formatWinRate(entry.winRate)} (${entry.totalGames.toString()} games)`,
    );
  });

  lines.push("");
  lines.push(
    `*Based on ${stats.totalMatchesAnalyzed.toString()} ${gameMode} games from the past month.*`,
  );

  return lines.join("\n");
}

/**
 * Generate the full Common Denominator message content
 */
function generateMessage(
  rankedStats: ServerPairingStats,
  arenaStats: ServerPairingStats,
  aramStats: ServerPairingStats,
  aliasToDiscordId: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push("# COMMON DENOMINATOR UPDATE");
  lines.push("");

  // Add ranked section
  lines.push(generateRankedSection(rankedStats, aliasToDiscordId));
  lines.push("");

  // Add Arena section (abbreviated)
  if (arenaStats.totalMatchesAnalyzed > 0) {
    lines.push(
      generateAbbreviatedSection(arenaStats, aliasToDiscordId, "Arena"),
    );
    lines.push("");
  }

  // Add ARAM section (abbreviated)
  if (aramStats.totalMatchesAnalyzed > 0) {
    lines.push(generateAbbreviatedSection(aramStats, aliasToDiscordId, "ARAM"));
  }

  return lines.join("\n");
}

/**
 * Run the weekly Common Denominator update
 * Returns information about whether the task ran and any error message
 */
export async function runWeeklyPairingUpdate(): Promise<{
  success: boolean;
  message: string;
}> {
  const serverId = MY_SERVER;
  const channelId = COMMON_DENOMINATOR_CHANNEL_ID;

  // Check if already running
  if (isRunning()) {
    const taskInfo = getTaskInfo();
    const runningFor = taskInfo.startedAt
      ? Math.round((Date.now() - taskInfo.startedAt.getTime()) / 1000)
      : 0;
    const message = `Pairing update is already running (started ${runningFor.toString()}s ago)`;
    logger.warn(`[WeeklyPairing] ${message}`);
    return { success: false, message };
  }

  // Start the task and get abort signal
  startTask();

  logger.info(
    `[WeeklyPairing] Running weekly pairing update for server ${serverId}`,
  );

  try {
    // Get all players for the server
    const players = await getServerPlayers(serverId);

    if (players.length === 0) {
      logger.warn("[WeeklyPairing] No players found for server, skipping");
      return { success: true, message: "No players found for server" };
    }

    logger.info(`[WeeklyPairing] Found ${players.length.toString()} players`);

    // Create alias to Discord ID map for mentions
    const aliasToDiscordId = createAliasToDiscordIdMap(players);

    // Calculate stats for the past month (last 4 weeks)
    const { year: currentYear, weekNumber: currentWeek } = getCurrentWeekInfo();

    logger.info(
      `[WeeklyPairing] Current week: ${currentYear.toString()}-W${currentWeek.toString()}`,
    );

    // Calculate for the past month (4 weeks before current week)
    const now = new Date();
    const monthAgo = subWeeks(now, 4);
    const startDate = startOfISOWeek(monthAgo);
    const endDate = endOfISOWeek(now);

    logger.info(
      `[WeeklyPairing] Calculating stats from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    // Calculate stats for all game modes
    const { ranked, arena, aram } = await calculateAllModeStats({
      players,
      startDate,
      endDate,
      serverId,
    });

    logger.info(
      `[WeeklyPairing] Calculated stats: Ranked=${ranked.totalMatchesAnalyzed.toString()}, Arena=${arena.totalMatchesAnalyzed.toString()}, ARAM=${aram.totalMatchesAnalyzed.toString()} matches`,
    );

    // Generate and send the message
    const message = generateMessage(ranked, arena, aram, aliasToDiscordId);

    // Log the full message for debugging
    logger.info("[WeeklyPairing] Generated message:");
    logger.info(message);

    // Log all qualified pairings to console for debugging (ranked only)
    const qualifiedPairings = ranked.pairings
      .filter(
        (p) => p.totalGames >= MIN_GAMES_FOR_RANKING && p.players.length >= 2,
      )
      .toSorted((a, b) => b.winRate - a.winRate);

    logger.info(
      `[WeeklyPairing] Full ranked pairings list (${qualifiedPairings.length.toString()} total):`,
    );
    qualifiedPairings.forEach((entry, index) => {
      const rank = index + 1;
      logger.info(
        `  ${rank.toString()}. ${entry.players.join(" + ")} - ${(entry.winRate * 100).toFixed(1)}% (W: ${entry.wins.toString()}, L: ${entry.losses.toString()})`,
      );
    });

    logger.info("[WeeklyPairing] Sending message to Discord");

    // Split message into chunks if it exceeds Discord's 2000 character limit
    const fullMessage = `@everyone\n\n${message}`;
    const messageChunks = splitMessageIntoChunks(fullMessage);

    logger.info(
      `[WeeklyPairing] Message split into ${messageChunks.length.toString()} chunk(s)`,
    );

    // Send each chunk sequentially to maintain order
    for (let i = 0; i < messageChunks.length; i++) {
      const chunk = messageChunks[i];
      if (chunk !== undefined && chunk.length > 0) {
        logger.info(
          `[WeeklyPairing] Sending chunk ${(i + 1).toString()}/${messageChunks.length.toString()}`,
        );
        await sendChannelMessage(
          {
            content: chunk,
          },
          channelId,
          serverId,
        );
      }
    }

    const totalMatches =
      ranked.totalMatchesAnalyzed +
      arena.totalMatchesAnalyzed +
      aram.totalMatchesAnalyzed;
    logger.info(
      "[WeeklyPairing] Successfully posted weekly Common Denominator update",
    );
    return {
      success: true,
      message: `Completed: ${totalMatches.toString()} matches analyzed across all modes`,
    };
  } catch (error) {
    logger.error("[WeeklyPairing] Error running weekly pairing update:", error);
    Sentry.captureException(error, {
      tags: { source: "weekly-pairing-update", serverId },
    });
    throw error;
  } finally {
    finishTask();
  }
}

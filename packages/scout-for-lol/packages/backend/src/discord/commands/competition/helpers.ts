/**
 * Helper functions for competition commands
 */

/**
 * Format criteria type to human-readable string
 */
export function formatCriteriaType(type: string): string {
  switch (type) {
    case "MOST_GAMES_PLAYED":
      return "Most Games Played";
    case "HIGHEST_RANK":
      return "Highest Rank";
    case "MOST_RANK_CLIMB":
      return "Most Rank Climb";
    case "MOST_WINS_PLAYER":
      return "Most Wins";
    case "MOST_WINS_CHAMPION":
      return "Most Wins (Champion)";
    case "HIGHEST_WIN_RATE":
      return "Highest Win Rate";
    default:
      return type;
  }
}

/**
 * Get status emoji for competition based on dates
 */
export function getStatusEmoji(startDate: Date | null, endDate: Date | null): string {
  if (startDate && endDate) {
    const now = new Date();
    return now < startDate ? "🔵" : "🟢"; // Draft vs Active
  }
  return "🟢"; // Season-based - active
}

/**
 * Format date information for competition
 */
export function formatDateInfo(startDate: Date | null, endDate: Date | null, seasonId: string | null): string {
  if (startDate && endDate) {
    const startTimestamp = String(Math.floor(startDate.getTime() / 1000));
    const endTimestamp = String(Math.floor(endDate.getTime() / 1000));
    return `**Starts:** <t:${startTimestamp}:F>\n**Ends:** <t:${endTimestamp}:F>`;
  }
  const seasonStr = seasonId ?? "Unknown";
  return `**Season:** ${seasonStr}`;
}

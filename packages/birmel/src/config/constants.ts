export const BOT_NAME = "Birmel";

export const TRIGGER_PATTERNS = [
  /\bbirmel\b/i,
  /\bhey birmel\b/i,
  /\byo birmel\b/i,
  /\bok birmel\b/i,
] as const;

/**
 * Generate a dynamic wake word based on the current guild owner's name.
 * Replaces the first letter with 'b' (e.g., "virmel" -> "birmel", "aaron" -> "baron").
 */
export function generateWakeWord(ownerName: string): string {
  if (!ownerName || ownerName.length === 0) {
    return "birmel"; // fallback
  }
  const lowerName = ownerName.toLowerCase();
  if (lowerName.startsWith("b")) {
    return lowerName; // Already starts with 'b'
  }
  return "b" + lowerName.slice(1);
}

export const DISCORD_MESSAGE_LIMIT = 2000;

export const RATE_LIMITS = {
  messagesPerMinute: 30,
  commandsPerMinute: 10,
} as const;

export const TIMEOUTS = {
  discordApiMs: 30_000,
  agentResponseMs: 120_000,
} as const;

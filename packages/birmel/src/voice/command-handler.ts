import { logger } from "../utils/index.js";
import { getOrCreateGuildOwner } from "../database/repositories/guild-owner.js";

/**
 * Generate a wake word from the owner's name by replacing the first letter with 'b'.
 * Examples: virmel -> birmel, aaron -> baron, jerred -> berred
 */
export function generateWakeWord(ownerName: string): string {
  if (!ownerName || ownerName.length === 0) {
    return "birmel"; // fallback
  }
  return "b" + ownerName.slice(1).toLowerCase();
}

/**
 * Create wake word regex patterns for a given wake word.
 */
function createWakePatterns(wakeWord: string): RegExp[] {
  const escaped = wakeWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(`\\bhey\\s+${escaped}\\b`, "i"),
    new RegExp(`\\b${escaped}\\b`, "i"),
    new RegExp(`\\bhi\\s+${escaped}\\b`, "i"),
    new RegExp(`\\bok\\s+${escaped}\\b`, "i"),
  ];
}

// Default wake patterns (used when no guild context available)
const DEFAULT_WAKE_PATTERNS = createWakePatterns("birmel");

export function containsWakeWord(text: string, wakeWord?: string): boolean {
  const normalized = text.toLowerCase().trim();
  const patterns = wakeWord ? createWakePatterns(wakeWord) : DEFAULT_WAKE_PATTERNS;
  return patterns.some((pattern) => pattern.test(normalized));
}

export function extractCommand(text: string, wakeWord?: string): string | null {
  const normalized = text.toLowerCase().trim();
  const patterns = wakeWord ? createWakePatterns(wakeWord) : DEFAULT_WAKE_PATTERNS;

  // Find which pattern matches
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      // Get everything after the wake word
      const afterWakeWord = normalized.slice(match.index + match[0].length).trim();

      // Remove common filler words at the start
      const cleaned = afterWakeWord
        .replace(/^(please|can you|could you|would you|i want you to)\s*/i, "")
        .trim();

      if (cleaned.length > 0) {
        return cleaned;
      }

      // If there's nothing after the wake word, check if the original text
      // has content before the wake word
      const beforeWakeWord = text.slice(0, match.index).trim();
      if (beforeWakeWord.length > 0) {
        return beforeWakeWord;
      }

      return null;
    }
  }

  return null;
}

export type VoiceCommand = {
  userId: string;
  guildId: string;
  channelId: string;
  rawText: string;
  command: string;
  timestamp: number;
};

export async function createVoiceCommand(
  userId: string,
  guildId: string,
  channelId: string,
  transcribedText: string,
): Promise<VoiceCommand | null> {
  // Look up the current guild owner to determine the wake word
  const guildOwner = await getOrCreateGuildOwner(guildId);
  const wakeWord = generateWakeWord(guildOwner.currentOwner);

  logger.debug("Using dynamic wake word", { guildId, owner: guildOwner.currentOwner, wakeWord });

  if (!containsWakeWord(transcribedText, wakeWord)) {
    logger.debug("No wake word detected", { text: transcribedText, wakeWord });
    return null;
  }

  const command = extractCommand(transcribedText, wakeWord);
  if (!command) {
    logger.debug("Wake word detected but no command", { text: transcribedText, wakeWord });
    return null;
  }

  return {
    userId,
    guildId,
    channelId,
    rawText: transcribedText,
    command,
    timestamp: Date.now(),
  };
}

// Common voice command shortcuts
const COMMAND_SHORTCUTS: Record<string, string> = {
  "play something": "play some music",
  "stop": "stop the music",
  "pause": "pause the music",
  "resume": "resume the music",
  "skip": "skip this song",
  "next": "skip to the next song",
  "louder": "increase the volume",
  "quieter": "decrease the volume",
  "mute": "set volume to 0",
  "unmute": "set volume to 50",
};

export function expandCommandShortcut(command: string): string {
  const normalized = command.toLowerCase().trim();
  return COMMAND_SHORTCUTS[normalized] ?? command;
}

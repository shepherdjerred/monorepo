import { logger } from "../utils/index.js";

// Wake word patterns for triggering the bot
const WAKE_PATTERNS = [
  /\bhey\s+birmel\b/i,
  /\bbirmel\b/i,
  /\bhi\s+birmel\b/i,
  /\bok\s+birmel\b/i,
];

export function containsWakeWord(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return WAKE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractCommand(text: string): string | null {
  const normalized = text.toLowerCase().trim();

  // Find which pattern matches
  for (const pattern of WAKE_PATTERNS) {
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

export function createVoiceCommand(
  userId: string,
  guildId: string,
  channelId: string,
  transcribedText: string,
): VoiceCommand | null {
  if (!containsWakeWord(transcribedText)) {
    logger.debug("No wake word detected", { text: transcribedText });
    return null;
  }

  const command = extractCommand(transcribedText);
  if (!command) {
    logger.debug("Wake word detected but no command", { text: transcribedText });
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

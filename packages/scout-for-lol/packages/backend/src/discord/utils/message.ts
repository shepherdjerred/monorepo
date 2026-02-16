/**
 * Discord message utilities
 *
 * Helpers for safely handling Discord message interactions
 */

/**
 * Discord's message content limit
 * @see https://discord.com/developers/docs/resources/channel#create-message
 */
const DISCORD_MESSAGE_MAX_LENGTH = 2000;

/**
 * Safe buffer to leave room for markdown formatting and other content
 */
const SAFE_MESSAGE_BUFFER = 100;

/**
 * Truncate a message to fit within Discord's 2000 character limit
 *
 * Discord has a hard limit of 2000 characters for message content.
 * This function ensures messages don't exceed that limit by truncating
 * and adding an ellipsis.
 *
 * @param message The message to truncate
 * @param maxLength Maximum length (default: 1900 to leave buffer for formatting)
 * @returns Truncated message with ellipsis if needed
 *
 * @example
 * ```ts
 * await interaction.reply({
 *   content: truncateDiscordMessage(longErrorMessage),
 *   ephemeral: true,
 * });
 * ```
 */
export function truncateDiscordMessage(
  message: string,
  maxLength: number = DISCORD_MESSAGE_MAX_LENGTH - SAFE_MESSAGE_BUFFER,
): string {
  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, maxLength)}...`;
}

/**
 * Truncate text for embed field values (1024 character limit)
 *
 * Discord embed field values have a limit of 1024 characters.
 *
 * @param text The text to truncate
 * @returns Truncated text with ellipsis if needed
 */
export function truncateEmbedFieldValue(text: string): string {
  const MAX_FIELD_VALUE_LENGTH = 1024;
  const FIELD_BUFFER = 20;
  const maxLength = MAX_FIELD_VALUE_LENGTH - FIELD_BUFFER;

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

/**
 * Truncate text for embed descriptions (4096 character limit)
 *
 * Discord embed descriptions have a limit of 4096 characters.
 *
 * @param text The text to truncate
 * @returns Truncated text with ellipsis if needed
 */
export function truncateEmbedDescription(text: string): string {
  const MAX_DESCRIPTION_LENGTH = 4096;
  const DESCRIPTION_BUFFER = 20;
  const maxLength = MAX_DESCRIPTION_LENGTH - DESCRIPTION_BUFFER;

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

/**
 * Split a long line into chunks by character count
 */
function splitLongLine(
  line: string,
  maxLength: number,
): { chunks: string[]; remaining: string } {
  const chunks: string[] = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }

  return { chunks, remaining };
}

/**
 * Process a line and add it to the current chunk or create new chunks as needed
 */
function processLine(
  line: string,
  currentChunk: string,
  maxLength: number,
  chunks: string[],
): { currentChunk: string; chunks: string[] } {
  // Line fits in current chunk
  if (currentChunk.length + line.length + 1 <= maxLength) {
    const newChunk =
      currentChunk.length > 0 ? `${currentChunk}\n${line}` : line;
    return { currentChunk: newChunk, chunks };
  }

  // Need to start new chunk - save current if it has content
  const updatedChunks =
    currentChunk.length > 0 ? [...chunks, currentChunk.trim()] : [...chunks];

  // Line itself is too long - split by characters
  if (line.length > maxLength) {
    const { chunks: lineChunks, remaining } = splitLongLine(line, maxLength);
    return {
      currentChunk: remaining,
      chunks: [...updatedChunks, ...lineChunks],
    };
  }

  return { currentChunk: line, chunks: updatedChunks };
}

/**
 * Split a section that exceeds the max length by processing line by line
 */
function splitLargeSection(
  section: string,
  maxLength: number,
  existingChunks: string[],
): { chunks: string[]; currentChunk: string } {
  const lines = section.split("\n");
  let currentChunk = "";
  let chunks = [...existingChunks];

  for (const line of lines) {
    const result = processLine(line, currentChunk, maxLength, chunks);
    currentChunk = result.currentChunk;
    chunks = result.chunks;
  }

  return { chunks, currentChunk };
}

/**
 * Split a message into chunks that respect Discord's character limit
 *
 * Splits at section boundaries (## headers) when possible to keep
 * related content together. If a single section exceeds the limit,
 * it will be split at line boundaries.
 *
 * @param message The message to split
 * @param maxLength Maximum length per chunk (default: 1900 for safety buffer)
 * @returns Array of message chunks
 */
export function splitMessageIntoChunks(
  message: string,
  maxLength: number = DISCORD_MESSAGE_MAX_LENGTH - SAFE_MESSAGE_BUFFER,
): string[] {
  // Handle empty message
  if (message.length === 0) {
    return [];
  }

  // If message fits in one chunk, return it as-is
  if (message.length <= maxLength) {
    return [message];
  }

  let chunks: string[] = [];
  let currentChunk = "";

  // Split by ## headers first (keeping the header with its content)
  const sections = message.split(/(?=^## )/m);

  for (const section of sections) {
    // Section fits in current chunk
    if (currentChunk.length + section.length <= maxLength) {
      currentChunk += section;
      continue;
    }

    // Save current chunk if it has content
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }

    // Section itself exceeds limit - split by lines
    if (section.length > maxLength) {
      const result = splitLargeSection(section, maxLength, chunks);
      chunks = result.chunks;
      currentChunk = result.currentChunk;
    } else {
      currentChunk = section;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

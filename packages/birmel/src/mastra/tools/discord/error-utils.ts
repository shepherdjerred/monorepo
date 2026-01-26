/**
 * Discord API error utilities.
 * We use duck-typing to detect Discord API errors since the class is from @discordjs/rest
 * which may not be directly importable in all contexts.
 */

export interface DiscordAPIErrorLike {
  code: number;
  status: number;
  message: string;
  method: string;
  url: string;
  name?: string;
}

/**
 * Check if an error looks like a DiscordAPIError based on its properties.
 */
export function isDiscordAPIError(error: unknown): error is DiscordAPIErrorLike {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  return (
    typeof e["code"] === "number" &&
    typeof e["status"] === "number" &&
    typeof e["message"] === "string" &&
    typeof e["method"] === "string" &&
    typeof e["url"] === "string"
  );
}

/**
 * Format a Discord API error for user-facing messages.
 */
export function formatDiscordAPIError(error: DiscordAPIErrorLike): string {
  return `Discord API Error [${String(error.code)}]: ${error.message}`;
}

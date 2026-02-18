/**
 * Discord API error utilities.
 * We use Zod validation to detect Discord API errors since the class is from @discordjs/rest
 * which may not be directly importable in all contexts.
 */

import { z } from "zod";

const DiscordAPIErrorSchema = z.object({
  code: z.number(),
  status: z.number(),
  message: z.string(),
  method: z.string(),
  url: z.string(),
  name: z.string().optional(),
});

export type DiscordAPIErrorLike = z.infer<typeof DiscordAPIErrorSchema>;

/**
 * Check if an error looks like a DiscordAPIError based on its properties.
 */
export function isDiscordAPIError(
  error: unknown,
): boolean {
  return DiscordAPIErrorSchema.safeParse(error).success;
}

/**
 * Parse an error as a DiscordAPIError, returning null if it doesn't match.
 */
export function parseDiscordAPIError(
  error: unknown,
): DiscordAPIErrorLike | null {
  const result = DiscordAPIErrorSchema.safeParse(error);
  return result.success ? result.data : null;
}

/**
 * Format a Discord API error for user-facing messages.
 */
export function formatDiscordAPIError(error: DiscordAPIErrorLike): string {
  return `Discord API Error [${String(error.code)}]: ${error.message}`;
}

import { type ChatInputCommandInteraction } from "discord.js";
import { replyError } from "#src/discord/commands/define-command.ts";

/**
 * Send a generic failure message in response to a deferred interaction
 * when the handler itself throws (rather than returning a domain-level
 * result). Without this the user is left looking at "Scout is
 * thinking…" indefinitely.
 *
 * Thin delegate to the shared {@link replyError}, which resolves the deferred
 * state and swallows send failures (expired interaction tokens).
 */
export async function editReplyOnError(
  interaction: ChatInputCommandInteraction,
  context: string,
  error: unknown,
): Promise<void> {
  await replyError(interaction, context, error);
}

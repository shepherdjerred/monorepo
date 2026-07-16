import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { z } from "zod";
import { fromError } from "zod-validation-error";
import { getErrorMessage } from "#src/utils/errors.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("define-command");

/**
 * Shared slash-command helper for the Discord command layer.
 *
 * Every command file historically repeated the same three chunks of
 * boilerplate: (1) build a raw args object from the interaction options and
 * `safeParse` it, replying with a friendly validation message on failure;
 * (2) reply with a uniform error message when the handler throws, handling the
 * deferred-vs-not distinction; and (3) format database errors. This module
 * consolidates all three so command files can stay focused on their logic.
 *
 * The bot registers builders (see `rest.ts`) and dispatches executors (see
 * `commands/index.ts`) separately by command name, so `defineCommand` is a
 * co-location convenience — it does not change how commands are wired.
 */

/** A slash-command builder in any of the shapes discord.js narrows to. */
export type AnyCommandBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export type CommandDefinition<T> = {
  builder: AnyCommandBuilder;
  /** Zod schema validating the parsed options, or `undefined` for no args. */
  args: z.ZodType<T> | undefined;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

/**
 * Co-locate a command's builder, args schema, and handler in one object.
 *
 * @example
 * ```typescript
 * export const meCommand = defineCommand({
 *   builder: new SlashCommandBuilder().setName("me")…,
 *   args: ArgsSchema,
 *   execute: async (interaction) => { … },
 * });
 * ```
 */
export function defineCommand<T>(
  definition: CommandDefinition<T>,
): CommandDefinition<T> {
  return definition;
}

export type ParseSuccess<T> = { success: true; data: T };
export type ParseFailure = { success: false };
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/**
 * Validate slash-command options against a Zod schema.
 *
 * On success returns `{ success: true, data }`. On failure (a system-boundary
 * user-input error — never a thrown exception) it replies to the interaction
 * with a friendly, ephemeral validation message and returns
 * `{ success: false }` so the handler can `return` early.
 *
 * `rawArgs` is the object read off the interaction options, matching the
 * historical `ArgsSchema.safeParse({ … })` call sites exactly.
 */
export async function parseCommandArgs<T>(
  interaction: ChatInputCommandInteraction,
  schema: z.ZodType<T>,
  rawArgs: unknown,
): Promise<ParseResult<T>> {
  const parseResult = schema.safeParse(rawArgs);
  if (!parseResult.success) {
    logger.info("❌ Invalid command arguments", parseResult.error);
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
      ephemeral: true,
    });
    return { success: false };
  }

  return { success: true, data: parseResult.data };
}

/**
 * Reply to an interaction with a uniform, ephemeral error message.
 *
 * Chooses `editReply` vs `reply` based on whether the interaction was already
 * replied to or deferred (so a deferred "thinking…" state resolves instead of
 * hanging), and never throws even if the underlying Discord call fails (the
 * interaction token may have expired).
 *
 * @param context - Short verb phrase describing what failed, e.g.
 *   `"creating subscription"`. Rendered as `❌ **Error <context>**`.
 */
export async function replyError(
  interaction: ChatInputCommandInteraction,
  context: string,
  error: unknown,
): Promise<void> {
  logger.error(`❌ Uncaught error during ${context}`, error);
  const content = `❌ **Error ${context}**\n\n${getErrorMessage(error)}`;
  try {
    await (interaction.replied || interaction.deferred
      ? interaction.editReply({ content })
      : interaction.reply({ content, ephemeral: true }));
  } catch (sendError) {
    // The interaction token may have expired (15 min) or Discord may have lost
    // the reply state. Nothing we can do — log and move on.
    logger.error("❌ Failed to send error reply", sendError);
  }
}

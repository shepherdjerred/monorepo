import { type ChatInputCommandInteraction } from "discord.js";
import type { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { parseCommandArgs } from "#src/discord/commands/define-command.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("utils-validation");

export type ValidationSuccess<T> = {
  success: true;
  data: T;
  userId: string;
  username: string;
};

export type ValidationFailure = {
  success: false;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validate command arguments with standardized error handling
 * Automatically replies to the interaction with validation errors
 */
export async function validateCommandArgs<T>(
  interaction: ChatInputCommandInteraction,
  schema: z.ZodType<T>,
  argsBuilder: (interaction: ChatInputCommandInteraction) => unknown,
  commandName: string,
): Promise<ValidationResult<T>> {
  const userId = DiscordAccountIdSchema.parse(interaction.user.id);
  const username = interaction.user.username;

  logger.info(`Starting ${commandName} for user ${username} (${userId})`);

  // Reading/coercing Discord options is system-boundary user input: a builder
  // throw gets the same friendly ephemeral reply as a schema failure instead
  // of rejecting the command.
  let rawArgs: unknown;
  try {
    rawArgs = argsBuilder(interaction);
  } catch (error) {
    logger.info(`❌ Failed to read command options for ${commandName}`, error);
    await interaction.reply({
      content: `❌ Invalid command options: ${error instanceof Error ? error.message : String(error)}`,
      ephemeral: true,
    });
    return { success: false };
  }

  const parseResult = await parseCommandArgs(interaction, schema, rawArgs);
  if (!parseResult.success) {
    return { success: false };
  }

  logger.info(`✅ Command arguments validated successfully`);
  return { success: true, data: parseResult.data, userId, username };
}

/**
 * Execute a command with timing metrics
 */
export async function executeWithTiming<T>(
  commandName: string,
  username: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await operation();
    const executionTime = Date.now() - startTime;
    logger.info(
      `✅ ${commandName} completed successfully for ${username} in ${executionTime.toString()}ms`,
    );
    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;
    logger.error(
      `❌ ${commandName} failed for ${username} after ${executionTime.toString()}ms:`,
      error,
    );
    throw error;
  }
}

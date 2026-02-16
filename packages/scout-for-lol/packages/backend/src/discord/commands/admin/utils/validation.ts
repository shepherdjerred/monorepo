import { type ChatInputCommandInteraction } from "discord.js";
import type { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { fromError } from "zod-validation-error";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

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

  try {
    const rawArgs = argsBuilder(interaction);
    const data = schema.parse(rawArgs);
    logger.info(`✅ Command arguments validated successfully`);
    return { success: true, data, userId, username };
  } catch (error) {
    logger.error(`❌ Invalid command arguments from ${username}:`, error);
    const validationError = fromError(error);
    await interaction.reply({
      content: validationError.toString(),
      ephemeral: true,
    });
    return { success: false };
  }
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

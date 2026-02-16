import { type ChatInputCommandInteraction } from "discord.js";
import type { z } from "zod";
import {
  validateCommandArgs,
  executeWithTiming,
} from "@scout-for-lol/backend/discord/commands/admin/utils/validation.ts";

/**
 * Higher-order function that combines validation and timing execution
 * Reduces boilerplate in Discord command handlers
 *
 * @example
 * ```typescript
 * export async function executeMyCommand(interaction: ChatInputCommandInteraction) {
 *   return executeCommand({
 *     interaction,
 *     schema: MySchema,
 *     argsBuilder: (i) => ({ field: i.options.getString("field") }),
 *     commandName: "my-command",
 *     handler: async ({ data, username }) => {
 *       // Command logic here
 *     }
 *   });
 * }
 * ```
 */
export async function executeCommand<T>(options: {
  interaction: ChatInputCommandInteraction;
  schema: z.ZodType<T>;
  argsBuilder: (interaction: ChatInputCommandInteraction) => unknown;
  commandName: string;
  handler: (context: {
    data: T;
    userId: string;
    username: string;
  }) => Promise<void>;
}): Promise<void> {
  const { interaction, schema, argsBuilder, commandName, handler } = options;
  const validation = await validateCommandArgs(
    interaction,
    schema,
    argsBuilder,
    commandName,
  );

  if (!validation.success) {
    return;
  }

  const { data, userId, username } = validation;

  await executeWithTiming(commandName, username, async () => {
    await handler({ data, userId, username });
  });
}

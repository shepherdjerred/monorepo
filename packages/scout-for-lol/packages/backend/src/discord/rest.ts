import { REST, Routes } from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import configuration from "@scout-for-lol/backend/configuration.ts";
import { debugCommand } from "@scout-for-lol/backend/discord/commands/debug.ts";
import { competitionCommand } from "@scout-for-lol/backend/discord/commands/competition/index.ts";
import { adminCommand } from "@scout-for-lol/backend/discord/commands/admin/index.ts";
import { subscriptionCommand } from "@scout-for-lol/backend/discord/commands/subscription/index.ts";
import { helpCommand } from "@scout-for-lol/backend/discord/commands/help.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("discord-rest");

logger.info("🔄 Preparing Discord slash commands for registration");

const commands = [
  subscriptionCommand.toJSON(),
  debugCommand.toJSON(),
  competitionCommand.toJSON(),
  adminCommand.toJSON(),
  helpCommand.toJSON(),
];

logger.info("📋 Commands to register:");
commands.forEach((command, index) => {
  logger.info(
    `  ${(index + 1).toString()}. ${command.name}: ${command.description}`,
  );
});

logger.info("🔑 Initializing Discord REST client");
const rest = new REST().setToken(configuration.discordToken);

void (async () => {
  try {
    logger.info(
      `🚀 Starting registration of ${commands.length.toString()} application (/) commands`,
    );
    logger.info(`🎯 Target application ID: ${configuration.applicationId}`);

    const startTime = Date.now();
    const data = await rest.put(
      Routes.applicationCommands(configuration.applicationId),
      { body: commands },
    );
    const registrationTime = Date.now() - startTime;

    logger.info(
      `✅ Successfully registered ${commands.length.toString()} application (/) commands in ${registrationTime.toString()}ms`,
    );

    // Log details about registered commands
    const CommandSchema = z.object({ name: z.string(), id: z.string() });
    const commandsResult = z.array(CommandSchema).safeParse(data);
    if (commandsResult.success) {
      logger.info("📝 Registered commands details:");
      commandsResult.data.forEach((command, index) => {
        logger.info(
          `  ${(index + 1).toString()}. ${command.name} (ID: ${command.id})`,
        );
      });
    }

    logger.info("🎉 Discord command registration completed successfully");
  } catch (error) {
    logger.error("❌ Failed to register Discord commands:", error);
    Sentry.captureException(error, {
      tags: { source: "discord-command-registration" },
    });

    // Log additional error context
    const ErrorDetailsSchema = z.object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    });
    const errorResult = ErrorDetailsSchema.safeParse(error);
    if (errorResult.success) {
      logger.error("❌ Error name:", errorResult.data.name);
      logger.error("❌ Error message:", errorResult.data.message);
      if (errorResult.data.stack !== undefined && errorResult.data.stack.length > 0) {
        logger.error("❌ Error stack:", errorResult.data.stack);
      }
    }

    // Check for specific Discord API errors
    const objectResult = z
      .object({ status: z.unknown() })
      .catchall(z.unknown())
      .safeParse(error);
    if (objectResult.success) {
      const discordError = objectResult.data;
      logger.error("❌ HTTP Status:", discordError.status);
      logger.error(
        "❌ Response body:",
        discordError["rawError"] ?? discordError["body"],
      );
    }

    process.exit(1);
  }
})();

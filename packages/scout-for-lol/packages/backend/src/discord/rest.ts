import {
  REST,
  Routes,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { z } from "zod";
import * as Sentry from "@sentry/bun";
import configuration from "#src/configuration.ts";
import {
  commandPayload,
  guildScopedCommandGroups,
} from "#src/discord/commands/definitions.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-rest");

logger.info("🔄 Preparing Discord slash commands for registration");

const commands = commandPayload;

logger.info("📋 Commands to register:");
commands.forEach((command, index) => {
  logger.info(
    `  ${(index + 1).toString()}. ${command.name}: ${command.description}`,
  );
});

logger.info("🔑 Initializing Discord REST client");
const rest = new REST().setToken(configuration.discordToken);

/**
 * Discord API error code for "the bot is not in that guild".
 * @see https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
const MISSING_ACCESS = 50_001;

function discordErrorCode(error: unknown): number | undefined {
  const parsed = z
    .object({ code: z.number() })
    .catchall(z.unknown())
    .safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

/**
 * Register per-guild commands for the guilds their flag is enabled in.
 *
 * Groups are merged by guild before sending, because a guild PUT **replaces**
 * that guild's entire command list for this application — two separate PUTs to
 * the same guild would leave only the last one's commands.
 *
 * A failure here is logged and skipped rather than fatal, unlike the global
 * registration above. The expected failure is `MISSING_ACCESS`: a flag names a
 * guild that this particular bot is not in, which is normal when the same flag
 * registry is shared by the beta and prod applications and only one of them was
 * invited. Exiting on that would crash-loop the other deployment over a
 * command it was never going to serve.
 */
async function registerGuildScopedCommands(): Promise<void> {
  const byGuild = new Map<string, RESTPostAPIApplicationCommandsJSONBody[]>();
  for (const group of guildScopedCommandGroups) {
    for (const guildId of listGuildsWithFlagEnabled(group.flag)) {
      byGuild.set(guildId, [...(byGuild.get(guildId) ?? []), ...group.payload]);
    }
  }

  if (byGuild.size === 0) {
    logger.info("📭 No guild-scoped commands to register");
    return;
  }

  for (const [guildId, payload] of byGuild) {
    const names = payload.map((command) => command.name).join(", ");
    try {
      await rest.put(
        Routes.applicationGuildCommands(configuration.applicationId, guildId),
        { body: payload },
      );
      logger.info(`✅ Registered [${names}] in guild ${guildId}`);
    } catch (error) {
      if (discordErrorCode(error) === MISSING_ACCESS) {
        logger.info(
          `⏭️  Skipping [${names}] for guild ${guildId} — this bot is not in it`,
        );
        continue;
      }
      logger.error(
        `❌ Failed to register [${names}] in guild ${guildId}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "discord-guild-command-registration", guildId },
      });
    }
  }
}

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

    await registerGuildScopedCommands();

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
      if (
        errorResult.data.stack !== undefined &&
        errorResult.data.stack.length > 0
      ) {
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

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
import {
  listGuildsWithFlagDeclared,
  listGuildsWithFlagEnabled,
} from "#src/configuration/flags.ts";
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
 * Reconcile per-guild commands against the flags that own them.
 *
 * **Reconcile, not register.** A guild PUT *replaces* that guild's entire
 * command list for this application, which is why groups are merged per guild
 * before sending — but it is also the only way to take a command back. So the
 * loop runs over every guild any group's flag *declares* (see
 * `listGuildsWithFlagDeclared`), not only the ones it is enabled in, and a
 * guild whose flag was switched off is visited with an empty payload. Sending
 * to enabled guilds alone left a disabled command sitting in its guild's picker
 * indefinitely, answering nothing, until the next unrelated deploy that
 * happened to re-add the flag.
 *
 * The corollary is the withdrawal contract stated on `listGuildsWithFlagDeclared`:
 * switch a guild's override to `false`, do not delete it, or there is nothing
 * left to reconcile against.
 *
 * `MISSING_ACCESS` is logged and skipped: a flag names a guild that this
 * particular bot is not in, which is normal when the same flag registry is
 * shared by the beta and prod applications and only one of them was invited.
 * Exiting on that would crash-loop the other deployment over a command it was
 * never going to serve. Every *other* failure — an invalid payload, a rejected
 * token, a 5xx — is a real registration failure that no later poll retries, so
 * it propagates to the caller's exit path rather than letting startup report
 * success over a guild that has no commands.
 */
async function registerGuildScopedCommands(): Promise<void> {
  const byGuild = new Map<string, RESTPostAPIApplicationCommandsJSONBody[]>();
  for (const group of guildScopedCommandGroups) {
    // Declared first, so a guild the flag is off for still gets an entry — an
    // empty payload, which is exactly the PUT that removes the command.
    for (const guildId of listGuildsWithFlagDeclared(group.flag)) {
      byGuild.set(guildId, byGuild.get(guildId) ?? []);
    }
    for (const guildId of listGuildsWithFlagEnabled(group.flag)) {
      byGuild.set(guildId, [...(byGuild.get(guildId) ?? []), ...group.payload]);
    }
  }

  if (byGuild.size === 0) {
    logger.info("📭 No guild-scoped commands declared");
    return;
  }

  for (const [guildId, payload] of byGuild) {
    const names = payload.map((command) => command.name).join(", ");
    try {
      await rest.put(
        Routes.applicationGuildCommands(configuration.applicationId, guildId),
        { body: payload },
      );
      logger.info(
        payload.length === 0
          ? `🧹 Cleared guild-scoped commands in guild ${guildId} — its flag is off`
          : `✅ Registered [${names}] in guild ${guildId}`,
      );
    } catch (error) {
      if (discordErrorCode(error) === MISSING_ACCESS) {
        logger.info(`⏭️  Skipping guild ${guildId} — this bot is not in it`);
        continue;
      }
      // Wrapped rather than bare, so the outer handler's Sentry event still
      // names the guild and the payload the bare Discord error would not.
      throw new Error(
        `Failed to reconcile guild-scoped commands [${names}] in guild ${guildId}`,
        { cause: error },
      );
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

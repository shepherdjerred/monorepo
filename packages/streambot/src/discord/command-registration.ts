/**
 * Slash-command registration, split out of `command-bot.ts` so that file stays under the 500-line
 * `max-lines` cap. Runs once per boot, on `ClientReady`.
 */
import { type Client, REST, Routes } from "discord.js";
import { commandJson } from "@shepherdjerred/streambot/discord/commands.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("command-registration");

/**
 * Publish `/stream` globally, then empty every guild-scoped command bucket. Global registration
 * means the commands work in every server the bot is invited to (the userbot pool decides which of
 * those it can actually stream into).
 *
 * The guild sweep matters because pre-pool deploys registered guild-scoped commands: Discord keeps
 * guild and global commands in separate buckets and a PUT to one never clears the other, so a
 * leftover guild copy shows up as a duplicate `/stream` in the picker.
 */
export async function registerGlobalCommands(
  client: Client,
  botToken: string,
  applicationId: string,
): Promise<void> {
  const rest = new REST().setToken(botToken);
  await rest.put(Routes.applicationCommands(applicationId), {
    body: commandJson,
  });
  log.info("slash commands registered", { count: commandJson.length });
  for (const guildId of client.guilds.cache.keys()) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
      body: [],
    });
  }
  log.info("stale guild-scoped commands cleared", {
    guilds: client.guilds.cache.size,
  });
}

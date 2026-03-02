import {
  type Client,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data/index.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { match } from "ts-pattern";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-commands");

import { executeHelp } from "#src/discord/commands/help.ts";
import { executeCompetitionCreate } from "#src/discord/commands/competition/create.ts";
import { executeCompetitionEdit } from "#src/discord/commands/competition/edit.ts";
import { executeCompetitionCancel } from "#src/discord/commands/competition/cancel.ts";
import { executeGrantPermission } from "#src/discord/commands/competition/grant-permission.ts";
import { executeCompetitionJoin } from "#src/discord/commands/competition/join.ts";
import { executeCompetitionInvite } from "#src/discord/commands/competition/invite.ts";
import { executeCompetitionLeave } from "#src/discord/commands/competition/leave.ts";
import { executeCompetitionView } from "#src/discord/commands/competition/view.ts";
import { executeCompetitionList } from "#src/discord/commands/competition/list.ts";

import {
  executeDebugDatabase,
  executeDebugPolling,
} from "#src/discord/commands/debug.ts";
import { executeDebugServerInfo } from "#src/discord/commands/debug/server-info.ts";
import {
  discordCommandsTotal,
  discordCommandDuration,
} from "#src/metrics/index.ts";
import { searchChampions } from "#src/utils/champion.ts";
import { executeAccountAdd } from "#src/discord/commands/admin/account-add.ts";
import { executeAccountDelete } from "#src/discord/commands/admin/account-delete.ts";
import { executeAccountTransfer } from "#src/discord/commands/admin/account-transfer.ts";
import { executePlayerDelete } from "#src/discord/commands/admin/player-delete.ts";
import { executePlayerEdit } from "#src/discord/commands/admin/player-edit.ts";
import { executePlayerLinkDiscord } from "#src/discord/commands/admin/player-link-discord.ts";
import { executePlayerMerge } from "#src/discord/commands/admin/player-merge.ts";
import { executePlayerUnlinkDiscord } from "#src/discord/commands/admin/player-unlink-discord.ts";
import { executePlayerView } from "#src/discord/commands/admin/player-view.ts";
import { executeDebugForceLeaderboardUpdate } from "#src/discord/commands/debug/force-leaderboard-update.ts";
import { executeDebugForceSnapshot } from "#src/discord/commands/debug/force-snapshot.ts";
import { executeDebugManageParticipant } from "#src/discord/commands/debug/manage-participant.ts";
import { executeDebugForcePairingUpdate } from "#src/discord/commands/debug/force-pairing-update.ts";
import { executeSubscriptionAdd } from "#src/discord/commands/subscription/add.ts";
import { executeSubscriptionDelete } from "#src/discord/commands/subscription/delete.ts";
import { executeSubscriptionList } from "#src/discord/commands/subscription/list.ts";

export function handleCommands(client: Client) {
  logger.info("⚡ Setting up Discord command handlers");

  // Handle autocomplete interactions
  client.on("interactionCreate", (interaction) => {
    void (async () => {
      if (interaction.isAutocomplete()) {
        const commandName = interaction.commandName;
        const focusedOption = interaction.options.getFocused(true);

        // Handle champion autocomplete for competition create command
        if (
          commandName === "competition" &&
          focusedOption.name === "champion"
        ) {
          const query = focusedOption.value;
          const results = searchChampions(query);

          await interaction.respond(
            results.map((champion) => ({
              name: champion.name,
              value: champion.id.toString(), // Store ID as string value
            })),
          );
          return;
        }

        // No autocomplete for this option
        await interaction.respond([]);
        return;
      }
    })();
  });

  // Handle command interactions
  client.on("interactionCreate", (interaction) => {
    void (async () => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      const startTime = Date.now();
      const commandName = interaction.commandName;
      const userId = DiscordAccountIdSchema.parse(interaction.user.id);
      const username = interaction.user.username;
      const guildId = interaction.guildId;
      const channelId = interaction.channelId;

      logger.info(
        `📥 Command received: ${commandName} from ${username} (${userId}) in guild ${guildId ?? "DM"} channel ${channelId}`,
      );

      // Log command options if any
      if (interaction.options.data.length > 0) {
        logger.info(
          `📝 Command options:`,
          interaction.options.data
            .map((opt) => `${opt.name}: ${String(opt.value)}`)
            .join(", "),
        );
      }

      try {
        switch (commandName) {
          case "subscription": {
            const subcommandName = interaction.options.getSubcommand();
            logger.info(`🔔 Executing subscription ${subcommandName} command`);

            await match(subcommandName)
              .with("add", () => executeSubscriptionAdd(interaction))
              .with("delete", () => executeSubscriptionDelete(interaction))
              .with("list", () => executeSubscriptionList(interaction))
              .otherwise(() => {
                logger.warn(
                  `⚠️  Unknown subscription subcommand: ${subcommandName}`,
                );
                return interaction.reply({
                  content: "Unknown subscription subcommand",
                  ephemeral: true,
                });
              });

            break;
          }
          case "competition": {
            const subcommandName = interaction.options.getSubcommand();
            logger.info(`🏆 Executing competition ${subcommandName} command`);

            await match(subcommandName)
              .with("create", async () => executeCompetitionCreate(interaction))
              .with("edit", async () => executeCompetitionEdit(interaction))
              .with("cancel", async () => executeCompetitionCancel(interaction))
              .with("grant-permission", async () =>
                executeGrantPermission(interaction),
              )
              .with("join", async () => executeCompetitionJoin(interaction))
              .with("invite", async () => executeCompetitionInvite(interaction))
              .with("leave", async () => executeCompetitionLeave(interaction))
              .with("view", async () => executeCompetitionView(interaction))
              .with("list", async () => executeCompetitionList(interaction))
              .otherwise(async () => {
                logger.warn(
                  `⚠️  Unknown competition subcommand: ${subcommandName}`,
                );
                await interaction.reply({
                  content: "Unknown competition subcommand",
                  ephemeral: true,
                });
              });

            break;
          }
          case "admin": {
            // Check if user has Administrator permissions (applies to all admin subcommands)
            const member = interaction.member;
            const PermissionSchema = z
              .object({ permissions: z.instanceof(PermissionsBitField) })
              .loose();
            const permissionResult = PermissionSchema.safeParse(member);
            const hasAdminPermission =
              permissionResult.success &&
              permissionResult.data.permissions.has(
                PermissionFlagsBits.Administrator,
              );

            if (!hasAdminPermission) {
              logger.warn(
                `⚠️  Unauthorized admin command access attempt by ${username} (${userId})`,
              );
              await interaction.reply({
                content:
                  "❌ Admin commands require Administrator permissions in this server.",
                ephemeral: true,
              });
              return;
            }

            const subcommandName = interaction.options.getSubcommand();
            logger.info(
              `🔧 Executing admin ${subcommandName} command (authorized: ${username})`,
            );

            await match(subcommandName)
              .with("player-edit", () => executePlayerEdit(interaction))
              .with("account-delete", () => executeAccountDelete(interaction))
              .with("account-add", () => executeAccountAdd(interaction))
              .with("account-transfer", () =>
                executeAccountTransfer(interaction),
              )
              .with("player-merge", () => executePlayerMerge(interaction))
              .with("player-delete", () => executePlayerDelete(interaction))
              .with("player-link-discord", () =>
                executePlayerLinkDiscord(interaction),
              )
              .with("player-unlink-discord", () =>
                executePlayerUnlinkDiscord(interaction),
              )
              .with("player-view", () => executePlayerView(interaction))
              .otherwise(() => {
                logger.warn(`⚠️  Unknown admin subcommand: ${subcommandName}`);
                return interaction.reply({
                  content: "Unknown admin subcommand",
                  ephemeral: true,
                });
              });

            break;
          }
          case "debug": {
            // Check if user has debug access (applies to all debug subcommands)
            if (!getFlag("debug", { user: userId })) {
              logger.warn(
                `⚠️  Unauthorized debug command access attempt by ${username} (${userId})`,
              );
              await interaction.reply({
                content:
                  "❌ Debug commands are only available to authorized users.",
                ephemeral: true,
              });
              return;
            }

            const subcommandName = interaction.options.getSubcommand();
            logger.info(
              `🐛 Executing debug ${subcommandName} command (authorized: ${username})`,
            );

            await match(subcommandName)
              .with("database", async () => executeDebugDatabase(interaction))
              .with("polling", async () => executeDebugPolling(interaction))
              .with("server-info", async () =>
                executeDebugServerInfo(interaction),
              )
              .with("force-snapshot", async () =>
                executeDebugForceSnapshot(interaction),
              )
              .with("force-leaderboard-update", async () =>
                executeDebugForceLeaderboardUpdate(interaction),
              )
              .with("manage-participant", async () =>
                executeDebugManageParticipant(interaction),
              )
              .with("force-pairing-update", async () =>
                executeDebugForcePairingUpdate(interaction),
              )
              .otherwise(async () => {
                logger.warn(`⚠️  Unknown debug subcommand: ${subcommandName}`);
                await interaction.reply({
                  content: "Unknown debug subcommand",
                  ephemeral: true,
                });
              });

            break;
          }
          case "help": {
            logger.info("❓ Executing help command");
            await executeHelp(interaction);

            break;
          }
          default: {
            logger.warn(`⚠️  Unknown command received: ${commandName}`);
            await interaction.reply("Unknown command");
          }
        }

        const executionTime = Date.now() - startTime;
        const executionTimeSeconds = executionTime / 1000;
        logger.info(
          `✅ Command ${commandName} completed successfully in ${executionTime.toString()}ms`,
        );

        // Record successful command metrics
        discordCommandsTotal.inc({ command: commandName, status: "success" });
        discordCommandDuration.observe(
          { command: commandName },
          executionTimeSeconds,
        );
      } catch (error) {
        const executionTime = Date.now() - startTime;
        const executionTimeSeconds = executionTime / 1000;
        logger.error(
          `❌ Command ${commandName} failed after ${executionTime.toString()}ms:`,
          error,
        );

        // Record failed command metrics
        discordCommandsTotal.inc({ command: commandName, status: "error" });
        discordCommandDuration.observe(
          { command: commandName },
          executionTimeSeconds,
        );
        logger.error(
          `❌ Error details - User: ${username} (${userId}), Guild: ${String(guildId)}, Channel: ${channelId}`,
        );

        const errorMessage =
          "❌ **There was an error while executing this command!**\n\n" +
          "If this issue persists, please report it:\n" +
          "• Open an issue on GitHub: https://github.com/shepherdjerred/scout-for-lol/issues\n" +
          "• Join our Discord server for support: https://discord.gg/qmRewyHXFE";

        await (interaction.replied || interaction.deferred
          ? interaction.followUp({
              content: errorMessage,
              ephemeral: true,
            })
          : interaction.reply({
              content: errorMessage,
              ephemeral: true,
            }));
      }
    })();
  });

  logger.info("✅ Discord command handlers configured");
}

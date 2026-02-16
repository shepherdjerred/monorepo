import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { executeCommand } from "@scout-for-lol/backend/discord/commands/utils/command-wrapper.ts";
import { findPlayerByAliasWithAccounts } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";
import { resolvePuuidFromRiotId } from "@scout-for-lol/backend/discord/commands/admin/utils/riot-api.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("admin-account-transfer");
import {
  buildRiotApiError,
  buildPlayerNotFoundError,
  buildDatabaseError,
  buildSuccessResponse,
} from "@scout-for-lol/backend/discord/commands/admin/utils/responses.ts";

const ArgsSchema = z.object({
  riotId: RiotIdSchema,
  region: RegionSchema,
  toPlayerAlias: z.string().min(1).max(100),
  guildId: DiscordGuildIdSchema,
});

export async function executeAccountTransfer(
  interaction: ChatInputCommandInteraction,
) {
  return executeCommand({
    interaction,
    schema: ArgsSchema,
    argsBuilder: (i) => ({
      riotId: i.options.getString("riot-id"),
      region: i.options.getString("region"),
      toPlayerAlias: i.options.getString("to-player-alias"),
      guildId: i.guildId,
    }),
    commandName: "account-transfer",
    handler: async ({ data: args }) => {
      const { riotId, region, toPlayerAlias, guildId } = args;
      // Resolve Riot ID to PUUID
      const puuidResult = await resolvePuuidFromRiotId(riotId, region);
      if (!puuidResult.success) {
        await interaction.reply(
          buildRiotApiError(
            `${riotId.game_name}#${riotId.tag_line}`,
            puuidResult.error,
          ),
        );
        return;
      }

      const { puuid } = puuidResult;

      // Find the account
      const account = await prisma.account.findUnique({
        where: {
          serverId_puuid: {
            serverId: guildId,
            puuid: puuid,
          },
        },
        include: {
          player: {
            include: {
              accounts: true,
            },
          },
        },
      });

      if (!account) {
        logger.info(
          `❌ Account not found: ${riotId.game_name}#${riotId.tag_line}`,
        );
        await interaction.reply({
          content: `❌ **Account not found**\n\nNo account with Riot ID ${riotId.game_name}#${riotId.tag_line} exists in this server.`,
          ephemeral: true,
        });
        return;
      }

      // Find the target player
      const targetPlayer = await findPlayerByAliasWithAccounts(
        prisma,
        guildId,
        toPlayerAlias,
      );
      if (!targetPlayer) {
        logger.info(`❌ Target player not found: "${toPlayerAlias}"`);
        await interaction.reply(buildPlayerNotFoundError(toPlayerAlias));
        return;
      }

      const sourcePlayer = account.player;

      // Check if transferring to the same player
      if (sourcePlayer.id === targetPlayer.id) {
        logger.info(`❌ Cannot transfer account to the same player`);
        await interaction.reply({
          content: `❌ **Invalid transfer**\n\nThe account is already owned by player "${toPlayerAlias}".`,
          ephemeral: true,
        });
        return;
      }

      // Check if this is the last account for the source player
      if (sourcePlayer.accounts.length === 1) {
        logger.info(
          `⚠️  Cannot transfer last account from player "${sourcePlayer.alias}" - player would have no accounts`,
        );
        await interaction.reply({
          content: `❌ **Cannot transfer last account**\n\nPlayer "${sourcePlayer.alias}" only has one account. Transferring it would leave the player with no accounts.\n\nIf you want to merge these players, use \`/admin player-merge\` instead.`,
          ephemeral: true,
        });
        return;
      }

      logger.info(
        `💾 Transferring account ${riotId.game_name}#${riotId.tag_line} from "${sourcePlayer.alias}" to "${targetPlayer.alias}"`,
      );

      try {
        const now = new Date();

        // Update the account to point to the new player
        await prisma.account.update({
          where: {
            id: account.id,
          },
          data: {
            playerId: targetPlayer.id,
            updatedTime: now,
          },
        });

        const sourceRemainingAccounts = sourcePlayer.accounts.filter(
          (acc) => acc.id !== account.id,
        );
        const targetNewAccounts = [...targetPlayer.accounts, account];

        await interaction.reply(
          buildSuccessResponse(
            `✅ **Account transferred successfully**\n\nTransferred ${riotId.game_name}#${riotId.tag_line} from "${sourcePlayer.alias}" to "${targetPlayer.alias}"`,
            `**"${sourcePlayer.alias}" now has ${sourceRemainingAccounts.length.toString()} account(s)**\n**"${targetPlayer.alias}" now has ${targetNewAccounts.length.toString()} account(s)**`,
          ),
        );
      } catch (error) {
        logger.error(`❌ Database error during account transfer:`, error);
        await interaction.reply(buildDatabaseError("transfer account", error));
      }
    },
  });
}

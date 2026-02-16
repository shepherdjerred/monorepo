import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data";
import { prisma } from "@scout-for-lol/backend/database/index.ts";
import { executeCommand } from "@scout-for-lol/backend/discord/commands/utils/command-wrapper.ts";
import { findPlayerByAliasWithAccounts } from "@scout-for-lol/backend/discord/commands/admin/utils/player-queries.ts";
import { resolvePuuidFromRiotId } from "@scout-for-lol/backend/discord/commands/admin/utils/riot-api.ts";
import {
  buildRiotApiError,
  buildAccountExistsError,
  buildDatabaseError,
  buildSuccessResponse,
} from "@scout-for-lol/backend/discord/commands/admin/utils/responses.ts";
import { backfillLastMatchTime } from "@scout-for-lol/backend/league/api/backfill-match-history.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";

const logger = createLogger("admin-account-add");

const ArgsSchema = z.object({
  riotId: RiotIdSchema,
  region: RegionSchema,
  playerAlias: z.string().min(1).max(100),
  guildId: DiscordGuildIdSchema,
});

export async function executeAccountAdd(interaction: ChatInputCommandInteraction) {
  return executeCommand({
    interaction,
    schema: ArgsSchema,
    argsBuilder: (i) => ({
      riotId: i.options.getString("riot-id"),
      region: i.options.getString("region"),
      playerAlias: i.options.getString("player-alias"),
      guildId: i.guildId,
    }),
    commandName: "account-add",
    handler: async ({ data: args, userId }) => {
      const { riotId, region, playerAlias, guildId } = args;
      // Find the player
      const player = await findPlayerByAliasWithAccounts(prisma, guildId, playerAlias, interaction);
      if (!player) {
        return;
      }

      // Resolve Riot ID to PUUID
      const puuidResult = await resolvePuuidFromRiotId(riotId, region);
      if (!puuidResult.success) {
        await interaction.reply(buildRiotApiError(`${riotId.game_name}#${riotId.tag_line}`, puuidResult.error));
        return;
      }

      const { puuid } = puuidResult;

      // Check if this account already exists
      const existingAccount = await prisma.account.findUnique({
        where: {
          serverId_puuid: {
            serverId: guildId,
            puuid: puuid,
          },
        },
        include: {
          player: true,
        },
      });

      if (existingAccount) {
        logger.info(`❌ Account already exists for player "${existingAccount.player.alias}"`);
        await interaction.reply(
          buildAccountExistsError(`${riotId.game_name}#${riotId.tag_line}`, existingAccount.player.alias, playerAlias),
        );
        return;
      }

      logger.info(`💾 Adding account ${riotId.game_name}#${riotId.tag_line} to player "${playerAlias}"`);

      try {
        const now = new Date();

        // Create the account
        await prisma.account.create({
          data: {
            alias: `${riotId.game_name}#${riotId.tag_line}`,
            puuid: LeaguePuuidSchema.parse(puuid),
            region: region,
            playerId: player.id,
            serverId: guildId,
            creatorDiscordId: DiscordAccountIdSchema.parse(userId),
            createdTime: now,
            updatedTime: now,
          },
        });

        // Backfill match history to initialize lastMatchTime
        // This prevents newly added players from being stuck on 1-minute polling interval
        const playerConfigEntry = {
          alias: playerAlias,
          league: {
            leagueAccount: {
              puuid: LeaguePuuidSchema.parse(puuid),
              region: region,
            },
          },
          ...(player.discordId && { discordAccount: { id: DiscordAccountIdSchema.parse(player.discordId) } }),
        };

        await backfillLastMatchTime(playerConfigEntry, LeaguePuuidSchema.parse(puuid));

        // Get updated player with all accounts
        const updatedPlayer = await prisma.player.findUnique({
          where: {
            id: player.id,
          },
          include: {
            accounts: true,
            subscriptions: true,
          },
        });

        const accountsList =
          updatedPlayer?.accounts.map((acc) => `• ${acc.alias} (${acc.region})`).join("\n") ?? "No accounts";
        const subscriptionsList =
          updatedPlayer && updatedPlayer.subscriptions.length > 0
            ? updatedPlayer.subscriptions.map((sub) => `<#${sub.channelId}>`).join(", ")
            : "No active subscriptions.";

        await interaction.reply(
          buildSuccessResponse(
            `✅ **Account added successfully**\n\nAdded ${riotId.game_name}#${riotId.tag_line} (${region}) to player "${playerAlias}"`,
            `**All accounts (${updatedPlayer?.accounts.length.toString() ?? "0"}):**\n${accountsList}\n\n**Subscribed channels:** ${subscriptionsList}`,
          ),
        );
      } catch (error) {
        logger.error(`❌ Database error during account addition:`, error);
        await interaction.reply(buildDatabaseError("add account", error));
      }
    },
  });
}

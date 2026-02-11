import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { DiscordAccountIdSchema, DiscordGuildIdSchema } from "@shepherdjerred/scout-data/index";
import { prisma } from "@shepherdjerred/scout-backend/database/index.ts";
import { executeCommand } from "@shepherdjerred/scout-backend/discord/commands/utils/command-wrapper.ts";
import { findPlayerByAliasWithSubscriptions } from "@shepherdjerred/scout-backend/discord/commands/admin/utils/player-queries.ts";
import { buildPlayerUpdateResponse } from "@shepherdjerred/scout-backend/discord/commands/admin/utils/player-responses.ts";
import { updatePlayerDiscordId } from "@shepherdjerred/scout-backend/discord/commands/admin/utils/player-updates.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";

const logger = createLogger("admin-player-link-discord");
import {
  validateDiscordLink,
  executeDiscordLinkOperation,
} from "@shepherdjerred/scout-backend/discord/commands/admin/utils/discord-link-helpers.ts";

const ArgsSchema = z.object({
  playerAlias: z.string().min(1).max(100),
  discordUserId: DiscordAccountIdSchema,
  guildId: DiscordGuildIdSchema,
});

export async function executePlayerLinkDiscord(interaction: ChatInputCommandInteraction) {
  return executeCommand({
    interaction,
    schema: ArgsSchema,
    argsBuilder: (i) => ({
      playerAlias: i.options.getString("player-alias"),
      discordUserId: i.options.getUser("discord-user")?.id,
      guildId: i.guildId,
    }),
    commandName: "player-link-discord",
    handler: async ({ data: args }) => {
      const { playerAlias, discordUserId, guildId } = args;

      // Find the player
      const player = await findPlayerByAliasWithSubscriptions(prisma, guildId, playerAlias, interaction);
      if (!player) {
        return;
      }

      // TypeScript narrowing: player is non-null here
      const playerNonNull: NonNullable<typeof player> = player;

      // Validate Discord link
      const validation = await validateDiscordLink({
        prisma,
        guildId,
        player: playerNonNull,
        discordUserId,
        playerAlias,
      });
      if (!validation.success) {
        await interaction.reply(validation.errorResponse);
        return;
      }

      logger.info(`💾 Linking Discord ID ${discordUserId} to player "${playerAlias}"`);

      await executeDiscordLinkOperation(
        interaction,
        async () => {
          const updatedPlayer = await updatePlayerDiscordId(prisma, playerNonNull.id, discordUserId);
          // updatePlayerDiscordId always returns a player (update operation never returns null)
          // Check that result is not null
          if (!updatedPlayer) {
            throw new Error("Failed to update player");
          }
          const updatedPlayerNonNull = updatedPlayer;

          await interaction.reply(
            buildPlayerUpdateResponse(
              updatedPlayerNonNull,
              "✅ **Discord ID linked successfully**",
              `Linked <@${discordUserId}> to player "${playerAlias}"`,
            ),
          );
        },
        "link",
      );
    },
  });
}

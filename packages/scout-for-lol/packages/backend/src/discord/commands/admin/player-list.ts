import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import {
  validateCommandArgs,
  executeWithTiming,
} from "#src/discord/commands/admin/utils/validation.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("admin-player-list");

const ArgsSchema = z.object({
  guildId: DiscordGuildIdSchema,
});

export async function executePlayerList(
  interaction: ChatInputCommandInteraction,
) {
  const validation = await validateCommandArgs(
    interaction,
    ArgsSchema,
    (i) => ({
      guildId: i.guildId,
    }),
    "player-list",
  );

  if (!validation.success) {
    return;
  }

  const { data: args, username } = validation;
  const { guildId } = args;

  await executeWithTiming("player-list", username, async () => {
    const players = await prisma.player.findMany({
      where: { serverId: guildId },
      include: {
        accounts: true,
        subscriptions: true,
      },
      orderBy: { alias: "asc" },
    });

    if (players.length === 0) {
      await interaction.reply({
        content:
          "📭 **No players found**\n\nThis server has no tracked players yet.\n\nUse `/subscription add` to start tracking a player.",
        ephemeral: true,
      });
      return;
    }

    logger.info(
      `📋 Found ${players.length.toString()} players in server ${guildId}`,
    );

    const lines: string[] = [];
    lines.push(`# 👥 All Players (${players.length.toString()})`);
    lines.push("");

    for (const player of players) {
      const accountCount = player.accounts.length;
      const subCount = player.subscriptions.length;
      const discordLink = player.discordId ? ` · <@${player.discordId}>` : "";
      const accountText = `${accountCount.toString()} account${accountCount === 1 ? "" : "s"}`;
      const subText = `${subCount.toString()} sub${subCount === 1 ? "" : "s"}`;

      lines.push(
        `• **${player.alias}** — ${accountText}, ${subText}${discordLink}`,
      );
    }

    const totalAccounts = players.reduce(
      (sum, p) => sum + p.accounts.length,
      0,
    );
    const totalSubs = players.reduce(
      (sum, p) => sum + p.subscriptions.length,
      0,
    );
    lines.push("");
    lines.push(
      `**Totals:** ${players.length.toString()} players, ${totalAccounts.toString()} accounts, ${totalSubs.toString()} subscriptions`,
    );

    const content = lines.join("\n");

    // Handle Discord's 2000 character limit
    if (content.length > 2000) {
      const chunks: string[] = [];
      let currentChunk = "";

      for (const line of lines) {
        if (currentChunk.length + line.length + 1 > 1900) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          currentChunk += (currentChunk ? "\n" : "") + line;
        }
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      const firstChunk = chunks[0];
      if (firstChunk === undefined) {
        await interaction.reply({
          content: "❌ Error: No content to display",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: firstChunk,
        ephemeral: true,
      });

      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk !== undefined) {
          await interaction.followUp({
            content: chunk,
            ephemeral: true,
          });
        }
      }
    } else {
      await interaction.reply({
        content,
        ephemeral: true,
      });
    }
  });
}

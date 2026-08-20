import { type SlashCommandSubcommandsOnlyBuilder } from "discord.js";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { buildPeekPassQuoteReply } from "#src/betting/peek-pass-button.ts";
import { describePeekResult, peekAtGame } from "#src/betting/peek.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";

export function addBbPeekSubcommands(
  command: SlashCommandSubcommandsOnlyBuilder,
): SlashCommandSubcommandsOnlyBuilder {
  return command
    .addSubcommand((subcommand) =>
      subcommand
        .setName("pass")
        .setDescription("Get a 24-hour peek-pass quote"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("peek")
        .setDescription("Privately reveal a live game's pregame estimate")
        .addStringOption((option) =>
          option
            .setName("game")
            .setDescription("A tracked player in the game")
            .setRequired(true),
        ),
    );
}

export async function replyBbPeekCommand(input: {
  subcommand: "pass" | "peek";
  interaction: BbCommandInteraction;
  serverId: DiscordGuildId;
  discordId: DiscordAccountId;
}): Promise<void> {
  if (input.subcommand === "pass") {
    await input.interaction.editReply(
      await buildPeekPassQuoteReply({
        ownerId: input.discordId,
        serverId: input.serverId,
      }),
    );
    return;
  }

  const result = await peekAtGame({
    serverId: input.serverId,
    discordId: input.discordId,
    requestedAlias: input.interaction.options.getString("game", true),
  });
  await input.interaction.editReply({ content: describePeekResult(result) });
}

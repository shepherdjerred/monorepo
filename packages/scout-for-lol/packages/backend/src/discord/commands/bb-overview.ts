import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { getLedgerPage } from "#src/betting/accounts.ts";
import {
  renderBucksHistory,
  resolveLedgerGameLabels,
} from "#src/betting/navigation.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import { buildBbPrizesEmbed } from "#src/discord/commands/bb-prizes.ts";
import { buildBbRulesEmbed } from "#src/discord/commands/bb-rules.ts";

export async function replyBbPrizes(
  interaction: BbCommandInteraction,
): Promise<void> {
  await interaction.editReply({ embeds: [buildBbPrizesEmbed()] });
}

export async function replyBbRules(
  interaction: BbCommandInteraction,
): Promise<void> {
  await interaction.editReply({ embeds: [buildBbRulesEmbed()] });
}

export async function replyBbHistory(
  interaction: BbCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
): Promise<void> {
  const page = await getLedgerPage({ serverId, discordId, page: 0 });
  const gameLabels = await resolveLedgerGameLabels(serverId, page.entries);
  await interaction.editReply(renderBucksHistory(discordId, page, gameLabels));
}

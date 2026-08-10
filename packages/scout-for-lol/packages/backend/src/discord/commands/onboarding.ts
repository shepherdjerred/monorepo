import { SlashCommandBuilder } from "discord.js";
import { getDashboardUrl, getDocsUrl } from "#src/discord/commands/links.ts";
import { buildDiscordInstallUrl } from "#src/lib/discord/install-url.ts";
import type { CommandReply } from "#src/discord/commands/define-command.ts";

type ReplyInteraction = { reply: CommandReply };
type StatusInteraction = ReplyInteraction & {
  client: { ws: { ping: number } };
  guild: { name: string } | null;
};

export const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("See the recommended Scout setup flow");

export const statusCommand = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Check Scout's connection status");

export const inviteCommand = new SlashCommandBuilder()
  .setName("invite")
  .setDescription("Add Scout to another Discord server");

export const docsCommand = new SlashCommandBuilder()
  .setName("docs")
  .setDescription("Open Scout's documentation");

export async function executeSetup(
  interaction: ReplyInteraction,
): Promise<void> {
  await interaction.reply({
    content: `Open the Scout dashboard to sign in, add Scout to a server, and configure everything in one place:\n${getDashboardUrl()}\n\nYou can try /track for a quick single-channel setup. Use the dashboard for additional channels, filters, queues, competitions, reports, and permissions.`,
    ephemeral: true,
  });
}

export async function executeStatus(
  interaction: StatusInteraction,
): Promise<void> {
  const ping = interaction.client.ws.ping;
  const guildText =
    interaction.guild === null
      ? "This command works best inside a server."
      : `Connected to **${interaction.guild.name}**.`;
  await interaction.reply({
    content: `✅ Scout is online. ${guildText}\nGateway latency: **${ping >= 0 ? `${ping.toString()} ms` : "checking"}**\n\nFor configuration and notification diagnostics, open the dashboard: ${getDashboardUrl()}`,
    ephemeral: true,
  });
}

export async function executeInvite(
  interaction: ReplyInteraction,
): Promise<void> {
  await interaction.reply({
    content: `Add Scout to another server:\n${buildDiscordInstallUrl()}\n\nIf Discord asks you to sign in first, use the dashboard setup flow: ${getDashboardUrl()}`,
    ephemeral: true,
  });
}

export async function executeDocs(
  interaction: ReplyInteraction,
): Promise<void> {
  await interaction.reply({
    content: `Scout documentation:\n${getDocsUrl()}`,
    ephemeral: true,
  });
}

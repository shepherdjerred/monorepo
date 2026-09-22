import { EmbedBuilder, Colors, SlashCommandBuilder } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { getDocsUrl, getDashboardUrl } from "#src/discord/commands/links.ts";
import type { CommandReply } from "#src/discord/commands/define-command.ts";
import { isExploreGuildAllowed } from "#src/explore/access.ts";
import { isPolicyEnabled, type FlagName } from "#src/configuration/flags.ts";

const logger = createLogger("commands-help");
type HelpInteraction = { guildId: string | null; reply: CommandReply };

export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Get help and view Scout's lightweight commands");

export async function executeHelp(interaction: HelpInteraction): Promise<void> {
  const dashboardUrl = getDashboardUrl();
  const docsUrl = getDocsUrl();
  const embed = new EmbedBuilder()
    .setTitle("Scout for League of Legends")
    .setDescription(
      "Scout watches tracked League matches and posts notifications and reports in Discord. Use the web dashboard for full setup and management.",
    )
    .setColor(Colors.Blue)
    .addFields(
      {
        name: "Start here",
        value: `**Dashboard:** ${dashboardUrl}\n**Documentation:** ${docsUrl}`,
      },
      {
        name: "Lightweight commands",
        value: await commandList(interaction.guildId),
      },
      {
        name: "Use the dashboard for",
        value:
          "Channels, filters, queues, competitions, scheduled reports, roles, permissions, audit history, and complete player/account management.",
      },
    )
    .setFooter({ text: "Scout for LoL • Web-first setup" });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  logger.info("✅ Help command completed successfully");
}

/**
 * Flag-gated commands are registered per guild (`guildScopedCommandGroups`),
 * so `/help` lists each one only where its flag is on — the same rationale as
 * registration: a globally advertised command that answers "not available
 * here" is a confusing dead end. `deploymentGate` covers gates that live
 * outside Flipt: voice additionally requires the boot-time
 * `VOICE_ASSISTANT_ENABLED` audio-pipeline gate, and a flag-on guild in a
 * deployment without it would still get "not switched on" from the command.
 */
const flagGatedCommands: {
  flag: FlagName;
  entry: string;
  deploymentGate?: () => boolean;
}[] = [
  {
    flag: "betting_enabled",
    entry: "`/bb` — Bryan Bucks: balances, history, rules, and dares",
  },
  {
    flag: "voice_assistant_enabled",
    entry: '`/scout join` · `/scout leave` — "Hey Scout" voice questions',
    // Not an activation gate — `voice_assistant_enabled` owns that. This only
    // avoids advertising a command that would answer "not configured in this
    // deployment": without a Realtime credential the join cannot be served, so
    // listing it would be a promise this pod cannot keep.
    deploymentGate: () =>
      configuration.voiceAssistant.openAiApiKey !== undefined,
  },
];

export async function commandList(guildId: string | null): Promise<string> {
  const commands = [
    "`/setup` — See the recommended web setup flow",
    "`/track` — Track one player in this channel",
    "`/list` — List tracked players",
    "`/status` — Check Scout's status",
    "`/invite` — Add Scout to another server",
    "`/docs` — Open the documentation",
  ];
  if (guildId !== null && isExploreGuildAllowed(guildId)) {
    commands.push("`/scout ask` — Ask a private, saved Explore question");
  }
  if (guildId !== null) {
    const server = DiscordGuildIdSchema.parse(guildId);
    for (const { flag, entry, deploymentGate } of flagGatedCommands) {
      if (deploymentGate !== undefined && !deploymentGate()) {
        continue;
      }
      if (await isPolicyEnabled(flag, { server })) {
        commands.push(entry);
      }
    }
  }
  return commands.join("\n");
}

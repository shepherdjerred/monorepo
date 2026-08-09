import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import {
  addSubscription,
  resolveSubscriptionPuuid,
  runBackfillAfterCommit,
} from "#src/lib/subscription/add.ts";
import { replyError } from "#src/discord/commands/define-command.ts";
import type {
  CommandEditReply,
  CommandReply,
} from "#src/discord/commands/define-command.ts";
import { getDashboardUrl } from "#src/discord/commands/links.ts";

export const trackCommand = new SlashCommandBuilder()
  .setName("track")
  .setDescription("Track one League player in this Discord channel")
  .addStringOption((option) =>
    option
      .setName("riot-id")
      .setDescription("Riot ID, for example Faker#KR1")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("region")
      .setDescription("League region")
      .setRequired(true)
      .addChoices(
        ...RegionSchema.options.map((region) => ({
          name: region,
          value: region,
        })),
      ),
  )
  .addStringOption((option) =>
    option
      .setName("alias")
      .setDescription("A short name for this tracked player")
      .setRequired(true),
  );

const ArgsSchema = z.object({
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdSchema,
  alias: z.string().trim().min(1).max(100),
  creatorDiscordId: DiscordAccountIdSchema,
});
type TrackInteraction = {
  guildId: string | null;
  channelId: string;
  user: { id: string };
  options: Pick<ChatInputCommandInteraction["options"], "getString">;
  replied: boolean;
  deferred: boolean;
  reply: CommandReply;
  deferReply: (
    ...args: Parameters<ChatInputCommandInteraction["deferReply"]>
  ) => Promise<unknown>;
  editReply: CommandEditReply;
};

export async function executeTrack(
  interaction: TrackInteraction,
): Promise<void> {
  const args = ArgsSchema.safeParse({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    region: interaction.options.getString("region"),
    riotId: interaction.options.getString("riot-id"),
    alias: interaction.options.getString("alias"),
    creatorDiscordId: interaction.user.id,
  });

  if (!args.success) {
    await interaction.reply({
      content:
        "`/track` can only be used in a server with valid player details.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const puuidResult = await resolveSubscriptionPuuid(
    args.data.riotId,
    args.data.region,
  );
  if (puuidResult.kind !== "ok") {
    await interaction.editReply({
      content: `Scout could not find that Riot ID: ${puuidResult.message}`,
    });
    return;
  }

  try {
    const result = await prisma.$transaction((tx) =>
      addSubscription(
        {
          guildId: args.data.guildId,
          channelId: args.data.channelId,
          region: args.data.region,
          riotId: args.data.riotId,
          alias: args.data.alias,
          creatorDiscordId: args.data.creatorDiscordId,
          filters: null,
        },
        LeaguePuuidSchema.parse(puuidResult.puuid),
        tx,
      ),
    );

    await interaction.editReply({ content: formatTrackResult(result) });

    if (result.kind === "created") {
      void runBackfillAfterCommit({
        alias: args.data.alias,
        puuid: LeaguePuuidSchema.parse(result.account.puuid),
        region: args.data.region,
        discordUserId: undefined,
      });
    }
  } catch (error) {
    await replyError(interaction, "tracking that player", error);
  }
}

export function formatTrackResult(
  result: Awaited<ReturnType<typeof addSubscription>>,
): string {
  switch (result.kind) {
    case "created":
      return `✅ Now tracking **${result.player.alias}** in this channel. Scout will post match notifications here.\n\nFor filters, queues, more channels, and full account management, open ${getDashboardUrl()}`;
    case "account-already-subscribed":
      return `ℹ️ That Riot account is already tracked as **${result.existingPlayerAlias}** in ${result.channelIds.length.toString()} channel${result.channelIds.length === 1 ? "" : "s"}.\n\nManage it from ${getDashboardUrl()}`;
    case "subscription-already-exists":
      return `ℹ️ **${result.playerAlias}** is already tracked in this channel.\n\nManage it from ${getDashboardUrl()}`;
    case "subscription-limit-reached":
      return `Scout's server limit has been reached (${result.current.toString()}/${result.max.toString()}). Manage existing subscriptions from ${getDashboardUrl()}`;
    case "account-limit-reached":
      return `Scout's account limit has been reached (${result.current.toString()}/${result.max.toString()}). Manage existing accounts from ${getDashboardUrl()}`;
    case "riot-id-not-found":
      return `Scout could not find that Riot ID: ${result.message}`;
    case "internal-error":
      return `Scout could not create the subscription: ${result.message}`;
  }
}

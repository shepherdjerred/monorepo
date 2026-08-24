import {
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
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
import { recordAudit } from "#src/lib/audit/index.ts";
import { captureFirstSubscriptionCreated } from "#src/analytics/guild-lifecycle.ts";
import type {
  CommandEditReply,
  CommandReply,
} from "#src/discord/commands/define-command.ts";
import { getDashboardUrl } from "#src/discord/commands/links.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";

export const trackCommand = new SlashCommandBuilder()
  .setName("track")
  .setDescription("Track one League player in this Discord channel")
  // Same gate the replaced `/subscription add` carried. Tracking a player
  // consumes the server's account and subscription quotas and creates
  // recurring posts in a channel, so it stays an administrator action.
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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

  // Seed the stored Riot ID from Riot's canonical casing rather than what the
  // user typed, matching subscriptionRouter.add — otherwise the same account
  // is stored differently depending on which surface created it.
  const canonicalRiotId = {
    game_name: puuidResult.gameName,
    tag_line: puuidResult.tagLine,
  };
  const initialHistoryImportEnabled = await isPolicyEnabled(
    "initial_match_history_import_enabled",
    { server: args.data.guildId },
  );

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await addSubscription(
        {
          guildId: args.data.guildId,
          channelId: args.data.channelId,
          region: args.data.region,
          riotId: canonicalRiotId,
          alias: args.data.alias,
          creatorDiscordId: args.data.creatorDiscordId,
          filters: null,
        },
        LeaguePuuidSchema.parse(puuidResult.puuid),
        tx,
        initialHistoryImportEnabled,
      );
      // The audit log is documented as covering Discord commands too, so the
      // row goes in the same transaction as the mutation — exactly as the web
      // path does via runAuditedMutation.
      if (created.kind === "created") {
        await recordAudit(
          {
            action: "SUBSCRIPTION_ADD",
            actorDiscordId: args.data.creatorDiscordId,
            serverId: args.data.guildId,
            targetChannelId: args.data.channelId,
            targetPlayerId: created.player.id,
            targetAccountId: created.account.id,
            payload: {
              riotId: args.data.riotId,
              region: args.data.region,
              alias: args.data.alias,
              isAddingToExistingPlayer: created.isAddingToExistingPlayer,
              source: "discord:/track",
            },
          },
          tx,
        );
      }
      // The subscription already existed, but the account row above is new, so
      // the mutation still needs a trail of its own.
      if (created.kind === "subscription-already-exists") {
        await recordAudit(
          {
            action: "ACCOUNT_ADD",
            actorDiscordId: args.data.creatorDiscordId,
            serverId: args.data.guildId,
            targetChannelId: args.data.channelId,
            targetPlayerId: created.playerId,
            targetAccountId: created.accountId,
            payload: {
              riotId: args.data.riotId,
              region: args.data.region,
              alias: args.data.alias,
              source: "discord:/track",
            },
          },
          tx,
        );
      }
      // addSubscription catches database failures and reports them as
      // `internal-error` instead of throwing. Returning here would let Prisma
      // commit whatever it managed first — typically a Player and Account with
      // no Subscription, which consumes the server's quota and makes every
      // retry answer `account-already-subscribed`. Throwing rolls that back,
      // and the catch below turns it into the user reply plus an `error` on
      // the command metric.
      if (created.kind === "internal-error") {
        throw new Error(
          `/track failed for ${args.data.alias}: ${created.message}`,
        );
      }
      return created;
    });

    // Record the milestone right after the transaction commits, before the
    // editReply attempt below — a transient Discord API failure there must
    // not cost the first-subscription capture, since later adds always see
    // isFirstSubscription === false and the milestone can never be recovered.
    if (result.kind === "created" && result.isFirstSubscription) {
      await captureFirstSubscriptionCreated(args.data.guildId, "discord");
    }

    await interaction.editReply({ content: formatTrackResult(result) });

    if (
      !initialHistoryImportEnabled &&
      (result.kind === "created" ||
        result.kind === "subscription-already-exists")
    ) {
      void runBackfillAfterCommit({
        alias: args.data.alias,
        puuid: LeaguePuuidSchema.parse(puuidResult.puuid),
        region: args.data.region,
        discordUserId: undefined,
      });
    }
  } catch (error) {
    await replyError(interaction, "tracking that player", error);
    // The user already has a friendly reply; rethrow so the dispatcher records
    // status="error" on discordCommandsTotal instead of counting this as a
    // success. It skips its own reply because the interaction is answered.
    throw error;
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
      // The account row is created before this branch, so an existing player
      // means a new Riot account was genuinely attached — not a no-op.
      return result.addedToExistingPlayer
        ? `✅ Added that Riot account to **${result.playerAlias}**, who was already tracked in this channel. Scout now follows ${result.accounts.length.toString()} account${result.accounts.length === 1 ? "" : "s"} for them.\n\nManage them from ${getDashboardUrl()}`
        : `ℹ️ **${result.playerAlias}** is already tracked in this channel.\n\nManage it from ${getDashboardUrl()}`;
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

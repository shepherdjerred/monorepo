import { type ChatInputCommandInteraction } from "discord.js";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  RegionSchema,
  RiotIdSchema,
  type RiotId,
} from "@scout-for-lol/data/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  addSubscription,
  resolveSubscriptionPuuid,
  runBackfillAfterCommit,
} from "#src/lib/subscription/add.ts";
import type { AddSubscriptionResult } from "#src/lib/subscription/types.ts";
import { sendWelcomeMatch } from "#src/discord/commands/subscription/welcome-match.ts";
import { DISCORD_SERVER_INVITE } from "#src/configuration/subscription-limits.ts";
import { prisma } from "#src/database/index.ts";
import { editReplyOnError } from "#src/discord/commands/subscription/reply-helpers.ts";

const logger = createLogger("subscription-add-command");

export const ArgsSchema = z.object({
  channel: DiscordChannelIdSchema,
  region: RegionSchema,
  riotId: RiotIdSchema,
  user: DiscordAccountIdSchema.optional(),
  alias: z.string(),
  guildId: DiscordGuildIdSchema,
});

export async function executeSubscriptionAdd(
  interaction: ChatInputCommandInteraction,
) {
  const startTime = Date.now();
  const creatorDiscordId = DiscordAccountIdSchema.parse(interaction.user.id);

  const parseResult = ArgsSchema.safeParse({
    channel: interaction.options.getChannel("channel")?.id,
    region: interaction.options.getString("region"),
    riotId: interaction.options.getString("riot-id"),
    user: interaction.options.getUser("user")?.id,
    alias: interaction.options.getString("alias"),
    guildId: interaction.guildId,
  });

  if (!parseResult.success) {
    logger.info("❌ Invalid command arguments", parseResult.error);
    await interaction.reply({
      content: fromError(parseResult.error).toString(),
      ephemeral: true,
    });
    return;
  }

  const args = parseResult.data;
  await interaction.deferReply({ ephemeral: true });

  // Resolve PUUID via Riot's API BEFORE opening the Prisma transaction —
  // a 1-3s Riot response inside a 5s tx would trip P2028.
  const puuidResult = await resolveSubscriptionPuuid(args.riotId, args.region);
  if (puuidResult.kind !== "ok") {
    await interaction.editReply({
      content: `Error looking up Riot ID: ${puuidResult.message}`,
    });
    return;
  }
  const puuid = puuidResult.puuid;

  let result;
  try {
    result = await prisma.$transaction((tx) =>
      addSubscription(
        {
          guildId: args.guildId,
          channelId: args.channel,
          region: args.region,
          riotId: args.riotId,
          alias: args.alias,
          discordUserId: args.user,
          creatorDiscordId,
        },
        puuid,
        tx,
      ),
    );
  } catch (error) {
    await editReplyOnError(interaction, "creating subscription", error);
    return;
  }

  await interaction.editReply({
    content: formatAddResult(result, args.riotId, args.alias, args.channel),
  });

  for (const warning of result.kind === "created" ? result.warnings : []) {
    const msg =
      warning.kind === "subscription-limit-near"
        ? `⚠️  **Approaching subscription limit**\n\nYou will have ${warning.remaining.toString()} subscription slot${warning.remaining === 1 ? "" : "s"} remaining after this addition.\n\nIf you need more subscriptions, please contact us: ${DISCORD_SERVER_INVITE}`
        : `⚠️  **Approaching account limit**\n\nYou will have ${warning.remaining.toString()} account slot${warning.remaining === 1 ? "" : "s"} remaining after this addition.\n\nIf you need more accounts, please contact us: ${DISCORD_SERVER_INVITE}`;
    await interaction.followUp({ content: msg, ephemeral: true });
  }

  if (result.kind === "created") {
    // Backfill is async + best-effort; never block the response on it.
    void runBackfillAfterCommit({
      alias: args.alias,
      puuid: LeaguePuuidSchema.parse(result.account.puuid),
      region: args.region,
      discordUserId: args.user,
    });
  }

  if (result.kind === "created" && result.isFirstSubscription) {
    const playerConfigEntry = {
      alias: args.alias,
      league: {
        leagueAccount: {
          puuid,
          region: RegionSchema.parse(args.region),
        },
      },
      ...(args.user !== undefined &&
        args.user.length > 0 && {
          discordAccount: { id: DiscordAccountIdSchema.parse(args.user) },
        }),
    };

    void (async () => {
      try {
        await sendWelcomeMatch(interaction, playerConfigEntry);
      } catch (error) {
        logger.error("❌ Error sending welcome match:", error);
      }
    })();
  }

  const totalTime = Date.now() - startTime;
  logger.info(`🎉 Subscription handler completed in ${totalTime.toString()}ms`);
}

function formatAddResult(
  result: AddSubscriptionResult,
  riotId: RiotId,
  alias: string,
  channelId: string,
): string {
  switch (result.kind) {
    case "created": {
      let message = `Successfully subscribed to updates for ${riotId.game_name}#${riotId.tag_line}`;
      if (result.isAddingToExistingPlayer) {
        const accountCount = result.player.accounts.length;
        const accountList = result.player.accounts
          .map((acc) => `• ${acc.alias} (${acc.region})`)
          .join("\n");
        message += `\n\n✨ **Added to existing player "${alias}"**`;
        message += `\nThis player now has ${accountCount.toString()} account${accountCount === 1 ? "" : "s"}:\n${accountList}`;
      } else {
        message += `\n\n✅ Created new player profile for "${alias}"`;
      }
      return message;
    }
    case "account-already-subscribed": {
      const channelList = result.channelIds.map((id) => `<#${id}>`).join(", ");
      return `ℹ️ **Account already subscribed**\n\nThe account **${riotId.game_name}#${riotId.tag_line}** is already subscribed as player "${result.existingPlayerAlias}".\n\n${result.channelIds.length > 0 ? `Currently posting to: ${channelList}` : "No active subscriptions."}`;
    }
    case "subscription-already-exists": {
      if (result.addedToExistingPlayer) {
        const accountCount = result.accounts.length;
        const accountList = result.accounts
          .map((acc) => `• ${acc.alias} (${acc.region})`)
          .join("\n");
        return `✅ **Account added successfully**\n\nAdded **${riotId.game_name}#${riotId.tag_line}** to player "${result.playerAlias}".\n\nThis player is already subscribed in <#${channelId}> and now has ${accountCount.toString()} account${accountCount === 1 ? "" : "s"}:\n${accountList}\n\nMatch updates for all accounts will continue to be posted there.`;
      }
      return `ℹ️ **Already subscribed**\n\nPlayer "${result.playerAlias}" is already subscribed in <#${channelId}>.\n\nMatch updates will continue to be posted there.`;
    }
    case "subscription-limit-reached":
      return `❌ **Subscription limit reached**\n\nThis server can subscribe to a maximum of ${result.max.toString()} players. You currently have ${result.current.toString()} subscribed players.\n\nTo subscribe to a new player, please unsubscribe from an existing player first using \`/subscription delete\`.\n\nIf you need more subscriptions, please contact us: ${DISCORD_SERVER_INVITE}`;
    case "account-limit-reached":
      return `❌ **Account limit reached**\n\nThis server can have a maximum of ${result.max.toString()} accounts. You currently have ${result.current.toString()} accounts.\n\nTo add a new account, please remove an existing account first.\n\nIf you need more accounts, please contact us: ${DISCORD_SERVER_INVITE}`;
    case "riot-id-not-found":
      return `Error looking up Riot ID: ${result.message}`;
    case "internal-error":
      return `Error creating database records: ${result.message}`;
  }
}

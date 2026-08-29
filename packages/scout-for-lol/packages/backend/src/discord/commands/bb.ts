import { formatInteger } from "@scout-for-lol/data";
import { EmbedBuilder } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/index.ts";
import {
  getPersonalBucksView,
  type PersonalBucksView,
} from "#src/betting/accounts.ts";
import {
  BUCKS_GUILD_ONLY,
  BUCKS_NOT_ENABLED,
  withRulesHint,
} from "#src/betting/copy.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { replyError } from "#src/discord/commands/define-command.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import {
  replyBucksAsk,
  type BucksAskAgentRunner,
} from "#src/discord/commands/bb-ask.ts";
import { buildBbRulesEmbed as createBbRulesEmbed } from "#src/discord/commands/bb-rules.ts";
import {
  replyBbNotifications,
  type BbNotificationCommandDependencies,
} from "#src/discord/commands/bb-notifications.ts";
import {
  replyBbHistory,
  replyBbPrizes,
  replyBbRules,
} from "#src/discord/commands/bb-overview.ts";
import {
  replyBbTransfer,
  type BbTransferCommandDependencies,
} from "#src/discord/commands/bb-transfer.ts";
import { truncateEmbedFieldValue } from "#src/discord/utils/message.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("command-bb");
export function buildBbRulesEmbed(): EmbedBuilder {
  return createBbRulesEmbed();
}

/**
 * `/bb` — the Bryan Bucks surface.
 *
 * Scout intentionally keeps management in the dashboard. This is a deliberate,
 * narrow beta exception: the feature is gated to a single guild by
 * `betting_enabled`, and a balance you cannot check from the same place you bet
 * is not usable.
 *
 * Production's hard-disable policy wins before the guild flag or Flipt, so the
 * command never registers or answers there.
 *
 * The command is registered per guild rather than globally
 * (`guildScopedCommandGroups`), so it is invisible everywhere it would not
 * work. The not-enabled-here reply below is therefore a narrow fallback for one
 * real case — the flag being switched off while a previously registered command
 * lingers — rather than the common path.
 *
 * Betting itself happens through the buttons on each market message; the
 * command tree is read-only surfaces plus preferences.
 */

const BUCKS_COLOR = 0x2e_cc_71;

type BbCommandDependencies = {
  runAskAgent?: BucksAskAgentRunner;
  isPolicyEnabled?: typeof isPolicyEnabled;
} & BbNotificationCommandDependencies &
  BbTransferCommandDependencies;

export function isPublicBbSubcommand(subcommand: string): boolean {
  return subcommand === "rules" || subcommand === "prizes";
}

export function buildPersonalBucksEmbed(
  view: PersonalBucksView,
  now: number = Date.now(),
): EmbedBuilder {
  const positions = view.pendingPositions.map((position) => {
    const timing =
      position.poolState === "open" && position.closesAt.getTime() > now
        ? `closes <t:${Math.floor(position.closesAt.getTime() / 1000).toString()}:R>`
        : "locked";
    if (position.marketType === "outcome") {
      const amount =
        position.matchedStake === null
          ? `offered up to ${formatInteger(position.offeredStake)} BB · match pending`
          : `matched ${formatInteger(position.matchedStake)} BB · refunded ${formatInteger(position.unmatchedStake ?? 0)} BB`;
      return `• **${position.gameAlias} ${position.sideLabel}** — ${amount} · ${timing}`;
    }
    return `• **${position.subjectAlias} ${position.side}** — ${formatInteger(position.stake)} BB · ${timing}`;
  });
  if (view.pendingPositionCount > view.pendingPositions.length) {
    positions.push(
      `…and ${formatInteger(view.pendingPositionCount - view.pendingPositions.length)} more pending position(s).`,
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("💰 Your Bryan Bucks")
    .setColor(BUCKS_COLOR)
    .addFields(
      {
        name: "Available",
        value: `**${formatInteger(view.balance)} BB**`,
        inline: true,
      },
      {
        name: "Reserved / at risk",
        value: `**${formatInteger(view.totalAtRisk)} BB**`,
        inline: true,
      },
    );
  if (positions.length > 0) {
    embed.addFields({
      name: "Pending positions",
      value: truncateEmbedFieldValue(positions.join("\n")),
    });
  }

  return embed;
}

async function replyBalance(
  interaction: BbCommandInteraction,
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>,
  discordId: ReturnType<typeof DiscordAccountIdSchema.parse>,
): Promise<void> {
  const view = await getPersonalBucksView({ serverId, discordId });
  if (view === undefined) {
    await interaction.editReply({
      content: withRulesHint(
        "No wallet yet — bet on a live game and you'll get a starting balance.",
      ),
    });
    return;
  }

  await interaction.editReply({
    embeds: [buildPersonalBucksEmbed(view)],
  });
}

export async function executeBb(
  interaction: BbCommandInteraction,
  dependencies: BbCommandDependencies = {},
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  try {
    if (interaction.guildId === null) {
      await interaction.reply({
        content: BUCKS_GUILD_ONLY,
        ephemeral: true,
      });
      return;
    }

    const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
    if (
      !(await (dependencies.isPolicyEnabled ?? isPolicyEnabled)(
        "betting_enabled",
        { server: serverId },
      ))
    ) {
      // Reachable only if the flag was turned off after registration, since
      // the command is not registered anywhere the flag is off.
      await interaction.reply({
        content: BUCKS_NOT_ENABLED,
        ephemeral: true,
      });
      return;
    }

    // Only rules and the prize catalog are public. Analysis starts private and
    // can be explicitly published by its asker.
    const ephemeral = !isPublicBbSubcommand(subcommand);
    await interaction.deferReply({ ephemeral });
    const discordId = DiscordAccountIdSchema.parse(interaction.user.id);

    switch (subcommand) {
      case "balance":
        await replyBalance(interaction, serverId, discordId);
        break;
      case "prizes":
        await replyBbPrizes(interaction);
        break;
      case "rules":
        await replyBbRules(interaction);
        break;
      case "history":
        await replyBbHistory(interaction, serverId, discordId);
        break;
      case "transfer":
        await replyBbTransfer(interaction, serverId, discordId, dependencies);
        break;
      case "ask":
        await replyBucksAsk(
          interaction,
          serverId,
          discordId,
          dependencies.runAskAgent === undefined
            ? {}
            : { runAgent: dependencies.runAskAgent },
        );
        break;
      case "notifications":
        await replyBbNotifications(
          interaction,
          serverId,
          discordId,
          dependencies,
        );
        break;
      default:
        await interaction.editReply({
          content: "Unknown subcommand. Try `/bb balance`.",
        });
        break;
    }
  } catch (error) {
    logger.error(`❌ /bb ${subcommand} failed:`, error);
    await replyError(interaction, `/bb ${subcommand}`, error);
  }
}

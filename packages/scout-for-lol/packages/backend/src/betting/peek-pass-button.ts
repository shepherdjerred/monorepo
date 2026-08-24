import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { BucksButtonEditReplyOptions } from "#src/betting/bet-button.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { BUCKS_GUILD_ONLY, BUCKS_NOT_ENABLED } from "#src/betting/copy.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  formatPeekPassCustomId,
  parsePeekPassCustomId,
} from "#src/betting/peek-pass-custom-id.ts";
import {
  PEEK_PASS_DURATION_LABEL,
  PEEK_PASS_QUOTE_TTL_MS,
  purchasePeekPass,
  quotePeekPass,
  type PeekPassPrice,
  type PeekPassQuoteResult,
} from "#src/betting/peek-pass.ts";
import { formatInteger } from "#src/betting/display-format.ts";

export type PeekPassButtonInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  editReply: (options: BucksButtonEditReplyOptions) => Promise<unknown>;
};

function relativeTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000).toString()}:R>`;
}

function quoteButton(input: {
  ownerId: DiscordAccountId;
  serverId: DiscordGuildId;
  quote: PeekPassPrice;
  quotedAt: Date;
}): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatPeekPassCustomId({
            action: "b",
            ownerId: input.ownerId,
            serverId: input.serverId,
            quotedAtMs: input.quotedAt.getTime(),
            quotedPrice: input.quote.price,
          }),
        )
        .setLabel(`Buy for ${formatInteger(input.quote.price)} BB`)
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function renderPeekPassQuote(
  ownerId: DiscordAccountId,
  serverId: DiscordGuildId,
  result: PeekPassQuoteResult,
): BucksButtonEditReplyOptions {
  switch (result.kind) {
    case "no_wallet":
      return {
        content:
          "You need an existing Bryan Bucks wallet before you can buy a peek pass.",
        components: [],
      };
    case "insufficient":
      return {
        content: `A peek pass costs at least **5 BB**. Your balance is **${formatInteger(result.balance)} BB**.`,
        components: [],
      };
    case "active":
      return {
        content: `Your peek pass is already active and expires ${relativeTime(result.expiresAt)}.`,
        components: [],
      };
    case "quoted": {
      const expiresAt = new Date(
        result.quotedAt.getTime() + PEEK_PASS_QUOTE_TTL_MS,
      );
      return {
        content:
          `A **${PEEK_PASS_DURATION_LABEL} peek pass** costs **${formatInteger(result.quote.price)} BB** for you right now. ` +
          `This quote expires ${relativeTime(expiresAt)}.`,
        components: quoteButton({
          ownerId,
          serverId,
          quote: result.quote,
          quotedAt: result.quotedAt,
        }),
      };
    }
  }
}

export async function handlePeekPassButton(
  interaction: PeekPassButtonInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const parsed = parsePeekPassCustomId(interaction.customId);
  if (parsed === undefined) {
    await interaction.deferUpdate();
    return;
  }
  if (interaction.guildId === null) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: BUCKS_GUILD_ONLY,
      components: [],
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const clickerId = DiscordAccountIdSchema.parse(interaction.user.id);
  const currentServerId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (clickerId !== parsed.ownerId || currentServerId !== parsed.serverId) {
    await interaction.editReply({
      content: "That peek-pass quote belongs to someone else.",
      components: [],
    });
    return;
  }
  if (
    !(await isPolicyEnabled("betting_enabled", { server: currentServerId }))
  ) {
    await interaction.editReply({
      content: BUCKS_NOT_ENABLED,
      components: [],
    });
    return;
  }

  const result = await purchasePeekPass(
    {
      serverId: currentServerId,
      discordId: clickerId,
      quotedAt: new Date(parsed.quotedAtMs),
      quotedPrice: parsed.quotedPrice,
    },
    prismaClient,
  );
  switch (result.kind) {
    case "purchased":
      await interaction.editReply({
        content:
          `✅ Peek pass active until ${relativeTime(result.expiresAt)}. ` +
          `Paid **${formatInteger(result.price)} BB** · balance **${formatInteger(result.balanceAfter)} BB**. Use \`/bb peek game:<player>\`.`,
        components: [],
      });
      return;
    case "quote_changed":
      await interaction.editReply(
        renderPeekPassQuote(clickerId, currentServerId, {
          kind: "quoted",
          quote: result.quote,
          quotedAt: result.quotedAt,
        }),
      );
      return;
    case "no_wallet":
    case "insufficient":
    case "active":
      await interaction.editReply(
        renderPeekPassQuote(clickerId, currentServerId, result),
      );
  }
}

export async function buildPeekPassQuoteReply(input: {
  ownerId: DiscordAccountId;
  serverId: DiscordGuildId;
  prismaClient?: ExtendedPrismaClient;
}): Promise<BucksButtonEditReplyOptions> {
  const result = await quotePeekPass(
    { serverId: input.serverId, discordId: input.ownerId },
    input.prismaClient,
  );
  return renderPeekPassQuote(input.ownerId, input.serverId, result);
}

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type BucksLedgerKind,
} from "@scout-for-lol/data";
import { z } from "zod";
import { getLedgerPage, type LedgerPage } from "#src/betting/accounts.ts";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { getFlag } from "#src/configuration/flags.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import type { BucksButtonEditReplyOptions } from "#src/betting/bet-button.ts";

export const BUCKS_NAVIGATION_NAMESPACE = "bbnav";
export const BUCKS_NAVIGATION_VERSION = "1";

const LEDGER_KIND_LABELS = {
  seed: "welcome grant",
  earn_game: "game played",
  earn_ranked_5s_bonus: "Ranked 5s bonus",
  earn_clash_bonus: "Clash bonus",
  earn_win: "game won",
  earn_mvp: "game MVP",
  bet_stake: "bet stake",
  bet_payout: "gross bet payout",
  bet_refund: "bet refund",
  house_rake: "house cut on payout",
  cancel_fee: "house cut on cancellation",
  parlay_stake: "parlay stake",
  parlay_reserve: "parlay house reserve",
  parlay_payout: "parlay payout",
  parlay_refund: "parlay refund",
  parlay_release: "parlay reserve release",
  adjustment: "adjustment",
} satisfies Record<BucksLedgerKind, string>;

export function ledgerKindLabel(kind: BucksLedgerKind): string {
  return LEDGER_KIND_LABELS[kind];
}

const BucksNavigationIdSchema = z.strictObject({
  action: z.literal("h"),
  ownerId: DiscordAccountIdSchema,
  snapshotId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  page: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type BucksNavigationId = z.infer<typeof BucksNavigationIdSchema>;

export function formatBucksNavigationId(input: BucksNavigationId): string {
  const parsed = BucksNavigationIdSchema.parse(input);
  const customId = [
    BUCKS_NAVIGATION_NAMESPACE,
    BUCKS_NAVIGATION_VERSION,
    parsed.action,
    parsed.ownerId,
    parsed.snapshotId.toString(),
    parsed.page.toString(),
  ].join(":");
  if (customId.length > 100) {
    throw new Error(
      `Bryan Bucks navigation ID exceeds Discord's 100-character limit: ${customId}`,
    );
  }
  return customId;
}

const EXPECTED_SEGMENTS = 6;

export function parseBucksNavigationId(
  raw: string,
): BucksNavigationId | undefined {
  const segments = raw.split(":");
  if (segments.length !== EXPECTED_SEGMENTS) {
    return undefined;
  }
  const [namespace, version, action, ownerId, snapshotId, page] = segments;
  if (
    namespace !== BUCKS_NAVIGATION_NAMESPACE ||
    version !== BUCKS_NAVIGATION_VERSION
  ) {
    return undefined;
  }
  const result = BucksNavigationIdSchema.safeParse({
    action,
    ownerId,
    snapshotId: Number(snapshotId),
    page: Number(page),
  });
  return result.success ? result.data : undefined;
}

export function isBucksNavigationId(raw: string): boolean {
  return raw.startsWith(`${BUCKS_NAVIGATION_NAMESPACE}:`);
}

function navigationRow(
  ownerId: ReturnType<typeof DiscordAccountIdSchema.parse>,
  page: LedgerPage,
): ActionRowBuilder<ButtonBuilder>[] {
  if (page.snapshotId === null || page.totalPages <= 1) {
    return [];
  }

  const previousPage = Math.max(page.page - 1, 0);
  const nextPage = Math.min(page.page + 1, page.totalPages - 1);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatBucksNavigationId({
            action: "h",
            ownerId,
            snapshotId: page.snapshotId,
            page: previousPage,
          }),
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.page === 0),
      new ButtonBuilder()
        .setCustomId(
          formatBucksNavigationId({
            action: "h",
            ownerId,
            snapshotId: page.snapshotId,
            page: nextPage,
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page.page >= page.totalPages - 1),
    ),
  ];
}

export function renderBucksHistory(
  ownerId: ReturnType<typeof DiscordAccountIdSchema.parse>,
  page: LedgerPage,
): BucksButtonEditReplyOptions {
  if (page.entries.length === 0) {
    return {
      content: `No Bryan Bucks history yet.\n\n${HOUSE_CUT_TERMS}`,
      components: [],
    };
  }

  const lines = page.entries.map((entry) => {
    const sign = entry.delta > 0 ? "+" : "";
    const where = entry.matchId === null ? "" : ` · ${entry.matchId}`;
    return `\`${sign}${entry.delta.toString()}\` ${ledgerKindLabel(entry.kind)}${where} → ${entry.balanceAfter.toString()} BB`;
  });
  return {
    content: [
      `**Bryan Bucks history** · Page ${(page.page + 1).toString()}/${page.totalPages.toString()}`,
      ...lines,
      "",
      HOUSE_CUT_TERMS,
    ].join("\n"),
    components: navigationRow(ownerId, page),
  };
}

export type BucksNavigationInteraction = {
  customId: string;
  guildId: string | null;
  user: { id: string };
  deferReply: (options: { ephemeral: true }) => Promise<unknown>;
  deferUpdate: () => Promise<unknown>;
  editReply: (options: BucksButtonEditReplyOptions) => Promise<unknown>;
};

export async function handleBucksNavigation(
  interaction: BucksNavigationInteraction,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const navigation = parseBucksNavigationId(interaction.customId);
  if (navigation === undefined) {
    await interaction.deferUpdate();
    return;
  }
  if (interaction.guildId === null) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "Bryan Bucks only works inside a server.",
      components: [],
    });
    return;
  }

  const clickerId = DiscordAccountIdSchema.parse(interaction.user.id);
  if (clickerId !== navigation.ownerId) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content:
        "Only the person who opened this history can use these controls.",
    });
    return;
  }

  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  if (!getFlag("betting_enabled", { server: serverId })) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "Bryan Bucks isn't enabled in this server.",
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();
  const page = await getLedgerPage(
    {
      serverId,
      discordId: clickerId,
      page: navigation.page,
      snapshotId: navigation.snapshotId,
    },
    prismaClient,
  );
  await interaction.editReply(renderBucksHistory(clickerId, page));
}

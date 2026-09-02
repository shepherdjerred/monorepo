import { EmbedBuilder } from "discord.js";
import {
  BUCKS_INT32_MAX,
  DiscordChannelIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import { DARE_MAX_TEXT_LENGTH } from "#src/betting/constants.ts";
import { bucksInsufficient } from "#src/betting/copy.ts";
import { dareConfirmationComponents } from "#src/betting/dare-callout.ts";
import {
  DARES_NOT_ENABLED,
  dareConfirmationContent,
} from "#src/betting/dare-copy.ts";
import { createProposedDare } from "#src/betting/dare-create.ts";
import {
  translateDare,
  type DareTranslationResult,
} from "#src/betting/dare-translate.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import {
  replyBbDareV2,
  type BbDareV2Dependencies,
} from "#src/discord/commands/bb-dare-v2.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("command-bb-dare");

/**
 * `/bb dare` — translate free text into a proposed bounty and show the
 * code-rendered confirmation.
 *
 * The `/bb` dispatcher has already deferred ephemerally and checked
 * `betting_enabled`; this adds the narrower `bucks_dares_enabled` gate, then
 * runs translate → create → confirmation embed. No money moves here: the
 * debit happens when the challenger clicks Confirm, so the early balance
 * check below is a friendlier error only — the guarded debit inside
 * `confirmDare` stays authoritative.
 */

const BUCKS_COLOR = 0x2e_cc_71;

export type BbDareCommandDependencies = {
  isDaresPolicyEnabled?: typeof isPolicyEnabled;
  isDareV2PolicyEnabled?: typeof isPolicyEnabled;
  translate?: typeof translateDare;
  createDare?: typeof createProposedDare;
  replyDareV2?: typeof replyBbDareV2;
  dareV2?: BbDareV2Dependencies;
  /** Best-effort wallet read for the friendlier pre-translation error. */
  loadDareBalance?: (
    serverId: DiscordGuildId,
    discordId: DiscordAccountId,
  ) => Promise<number | undefined>;
};

async function defaultLoadDareBalance(
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<number | undefined> {
  const account = await prismaClient.bucksAccount.findUnique({
    where: { serverId_discordId: { serverId, discordId } },
    select: { balance: true },
  });
  return account?.balance;
}

const DareOptionsSchema = z.strictObject({
  dare: z.string().min(1).max(DARE_MAX_TEXT_LENGTH),
  amount: z.number().int().min(1).max(BUCKS_INT32_MAX),
});

export function describeDareTranslationFailure(
  result: Exclude<DareTranslationResult, { kind: "translated" }>,
): string {
  switch (result.kind) {
    case "unmappable":
      return `🤔 I can't turn that into a dare: ${result.reason}`;
    case "timeout":
      return "⏳ The dare translator took too long. Try again in a moment.";
    case "budget_refused":
      return "🧯 The dare translator is out of budget right now. Try again later.";
    case "invalid_output":
      return "🤖 The translator couldn't produce a usable dare from that. Try rewording it.";
    case "provider_error":
      return "😵 The dare translator failed. Try again shortly.";
  }
}

async function enabledDareVersion(
  serverId: DiscordGuildId,
  dependencies: BbDareCommandDependencies,
): Promise<1 | 2 | null> {
  const v2Policy =
    dependencies.isDareV2PolicyEnabled ??
    (dependencies.isDaresPolicyEnabled === undefined ? isPolicyEnabled : null);
  if (v2Policy !== null) {
    const [v2Enabled, relationalEnabled] = await Promise.all([
      v2Policy("dare_v2", { server: serverId }),
      v2Policy("scoutql_relational_enabled", { server: serverId }),
    ]);
    if (v2Enabled && relationalEnabled) return 2;
  }
  const v1Policy = dependencies.isDaresPolicyEnabled ?? isPolicyEnabled;
  return (await v1Policy("bucks_dares_enabled", { server: serverId }))
    ? 1
    : null;
}

export async function replyBbDare(
  interaction: BbCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  dependencies: BbDareCommandDependencies = {},
): Promise<void> {
  const dareVersion = await enabledDareVersion(serverId, dependencies);
  if (dareVersion === null) {
    await interaction.editReply({ content: DARES_NOT_ENABLED });
    return;
  }
  // Discord's option bounds already enforce these; re-validated anyway
  // because the option payload is boundary input, not a contract.
  const options = DareOptionsSchema.safeParse({
    dare: interaction.options.getString("dare", true),
    amount: interaction.options.getInteger("amount", true),
  });
  if (!options.success) {
    await interaction.editReply({
      content: `💱 A dare needs text up to ${DARE_MAX_TEXT_LENGTH.toString()} characters and a positive whole-BB amount.`,
    });
    return;
  }
  const { dare: text, amount } = options.data;
  if (interaction.channelId === null) {
    await interaction.editReply({
      content: "🏠 Run `/bb dare` in a server channel.",
    });
    return;
  }
  const channelId = DiscordChannelIdSchema.parse(interaction.channelId);

  // Best-effort early balance check for a friendlier error before the model
  // call; a missing wallet is fine (confirm ensures one), and the guarded
  // debit at confirm time stays authoritative.
  try {
    const balance = await (
      dependencies.loadDareBalance ?? defaultLoadDareBalance
    )(serverId, discordId);
    if (balance !== undefined && balance < amount) {
      await interaction.editReply({
        content: bucksInsufficient(balance, amount),
      });
      return;
    }
  } catch (error) {
    logger.warn(
      `⚠️ Skipping the early dare balance check for ${serverId}:`,
      error,
    );
  }

  if (dareVersion === 2) {
    await (dependencies.replyDareV2 ?? replyBbDareV2)(
      interaction,
      {
        serverId,
        channelId,
        challengerDiscordId: discordId,
        text,
        amount,
      },
      dependencies.dareV2,
    );
    return;
  }

  const translation = await (dependencies.translate ?? translateDare)({
    serverId,
    challengerDiscordId: discordId,
    text,
  });
  if (translation.kind !== "translated") {
    await interaction.editReply({
      content: describeDareTranslationFailure(translation),
    });
    return;
  }

  const created = await (dependencies.createDare ?? createProposedDare)({
    serverId,
    channelId,
    challengerDiscordId: discordId,
    originalText: text,
    translation: JSON.stringify(translation.record),
    conditions: translation.conditions,
    horizonKind: translation.horizonKind,
    windowDays: translation.windowDays ?? undefined,
    amount,
    targets: translation.targets.map((target) => ({
      discordId: target.discordId,
      playerId: target.playerId,
      alias: target.alias,
      accounts: target.accounts,
    })),
  });
  if (created.kind === "feature_disabled") {
    await interaction.editReply({ content: DARES_NOT_ENABLED });
    return;
  }
  if (created.kind === "invalid") {
    await interaction.editReply({
      content: [
        "🚫 That dare can't be created:",
        ...created.issues.map((issue) => `• ${issue}`),
      ].join("\n"),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("🎯 Confirm your dare")
    .setColor(BUCKS_COLOR)
    .setDescription(
      dareConfirmationContent({
        amount,
        targetAliases: translation.targets.map((target) => target.alias),
        conditionSummary: created.conditionSummary,
        horizonKind: translation.horizonKind,
        windowDays: translation.windowDays,
        proposalExpiresAt: created.proposalExpiresAt,
      }),
    );
  await interaction.editReply({
    embeds: [embed],
    components: dareConfirmationComponents(created.dareId),
  });
}

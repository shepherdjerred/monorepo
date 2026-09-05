import * as Sentry from "@sentry/bun";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import {
  BucksDareHorizonKindSchema,
  BucksDareStateSchema,
  BucksMessageRefSchema,
  DiscordChannelIdSchema,
  type BucksDareState,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { DARE_CONTRIBUTION_STAKES } from "#src/betting/constants.ts";
import {
  dareCalloutContent,
  dareLeafProgress,
  type DareCalloutView,
} from "#src/betting/dares/presentation/dare-copy.ts";
import {
  DareConditionsSchema,
  dareLeavesInCanonicalOrder,
  evaluateDareTree,
  parseLeafHits,
  renderDareConditions,
} from "#src/betting/dares/evaluation/dare-criteria.ts";
import {
  abandonDare,
  confirmDare,
} from "#src/betting/dares/lifecycle/dare-create.ts";
import {
  acceptDare,
  declineDare,
} from "#src/betting/dares/lifecycle/dare-accept.ts";
import { contributeToDare } from "#src/betting/dares/lifecycle/dare-contribute.ts";
import { formatDareCustomId } from "#src/betting/dares/lifecycle/dare-custom-id.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import { runSerialized } from "#src/betting/refresh-queue.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { client } from "#src/discord/client.ts";
import { send } from "#src/league/discord/channel.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-callout");

/**
 * The dare callout message: its buttons, its database-driven render, and the
 * serialized in-place refresh both the button handler and the settlement
 * delivery layer share. The callout is ONE public message per dare, edited
 * through every lifecycle transition from fresh database state — never from
 * interaction state — through `runSerialized("dare:<id>")`, so an older
 * refresh can never land after a newer one.
 */

/**
 * Store the callout's message reference, retrying once. Returns false — and
 * reports to Sentry — when both attempts fail; never throws, because by the
 * time it runs the callout message already exists and the stake is already
 * committed, so the caller owes the challenger an accurate degraded message
 * rather than a rollback. Without the stored ref `refreshDareCallout` skips
 * this dare forever, which is why one retry is worth paying for.
 */
export async function persistDareCalloutRef(
  prismaClient: ExtendedPrismaClient,
  dareId: number,
  ref: { channelId: string; messageId: string },
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prismaClient.bucksDare.update({
        where: { id: dareId },
        data: { messageRef: JSON.stringify(ref) },
      });
      return true;
    } catch (error) {
      logger.error(
        `❌ Could not persist the callout ref for dare ${dareId.toString()} (attempt ${(attempt + 1).toString()}):`,
        error,
      );
      if (attempt === 1) {
        Sentry.captureException(error, {
          tags: {
            source: "betting-dare-callout-ref",
            dareId: dareId.toString(),
          },
        });
      }
    }
  }
  return false;
}

export type DareMessageSender = (
  options: MessageCreateOptions,
  channelId: DiscordChannelId,
  serverId: DiscordGuildId,
) => Promise<{ channelId: string; id: string }>;

export type DareMessageEditor = (input: {
  channelId: DiscordChannelId;
  messageId: string;
  options: MessageEditOptions;
}) => Promise<void>;

const defaultEditMessage: DareMessageEditor = async (input) => {
  const channel = await client.channels.fetch(input.channelId);
  if (channel?.isTextBased() !== true) {
    throw new Error(
      `Bryan Bucks dare channel ${input.channelId} is unavailable or not text based`,
    );
  }
  await channel.messages.edit(input.messageId, input.options);
};

export type DareDiscordDependencies = {
  prismaClient: ExtendedPrismaClient;
  confirm: typeof confirmDare;
  abandon: typeof abandonDare;
  accept: typeof acceptDare;
  decline: typeof declineDare;
  contribute: typeof contributeToDare;
  sendMessage: DareMessageSender;
  editMessage: DareMessageEditor;
};

export const defaultDareDiscordDependencies: DareDiscordDependencies = {
  prismaClient: prisma,
  confirm: confirmDare,
  abandon: abandonDare,
  accept: acceptDare,
  decline: declineDare,
  contribute: contributeToDare,
  sendMessage: send,
  editMessage: defaultEditMessage,
};

/** Confirm / Cancel row for the ephemeral confirmation `/bb dare` shows. */
export function dareConfirmationComponents(
  dareId: number,
): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(formatDareCustomId({ action: "c", dareId }))
        .setLabel("Confirm dare")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(formatDareCustomId({ action: "n", dareId }))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function contributionButtons(dareId: number): ButtonBuilder[] {
  return DARE_CONTRIBUTION_STAKES.map((amount) =>
    new ButtonBuilder()
      .setCustomId(formatDareCustomId({ action: "p", dareId, amount }))
      .setLabel(`Pile on +${amount.toString()} BB`)
      .setStyle(ButtonStyle.Primary),
  );
}

/** The public callout's components for a given lifecycle state. */
export function dareCalloutComponents(
  dareState: BucksDareState,
  dareId: number,
): ActionRowBuilder<ButtonBuilder>[] {
  if (dareState === "pending_accept") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(formatDareCustomId({ action: "a", dareId }))
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(formatDareCustomId({ action: "d", dareId }))
          .setLabel("Chicken out 🐔")
          .setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...contributionButtons(dareId),
      ),
    ];
  }
  if (dareState === "active") {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...contributionButtons(dareId),
      ),
    ];
  }
  return [];
}

export type DareCalloutState = {
  serverId: string;
  messageRef: string | null;
  dareState: BucksDareState;
  view: DareCalloutView;
};

/** One dare's callout view, read fresh from the database. */
export async function loadDareCalloutState(
  prismaClient: ExtendedPrismaClient,
  dareId: number,
): Promise<DareCalloutState | undefined> {
  const dare = await prismaClient.bucksDare.findUnique({
    where: { id: dareId },
    include: {
      targets: { orderBy: { id: "asc" } },
      games: { orderBy: { id: "asc" }, select: { leafHits: true } },
    },
  });
  if (dare === null) return undefined;
  const conditions = DareConditionsSchema.parse(JSON.parse(dare.conditions));
  const dareState = BucksDareStateSchema.parse(dare.dareState);
  const leafCounts = evaluateDareTree(
    conditions,
    dare.games.map((game) => ({ leafHits: parseLeafHits(game.leafHits) })),
  ).leafCounts;
  return {
    serverId: dare.serverId,
    messageRef: dare.messageRef,
    dareState,
    view: {
      dareState,
      challengerDiscordId: dare.challengerDiscordId,
      potTotal: dare.potTotal,
      horizonKind: BucksDareHorizonKindSchema.parse(dare.horizonKind),
      conditionSummary: renderDareConditions(
        conditions,
        dare.targets.map((target) => target.alias),
      ),
      targets: dare.targets.map((target) => ({
        discordId: target.discordId,
        alias: target.alias,
        accepted: target.acceptedAt !== null,
        declined: target.declinedAt !== null,
      })),
      acceptDeadline: dare.acceptDeadline,
      windowEndsAt: dare.windowEndsAt,
      progress: dareLeafProgress(
        dareLeavesInCanonicalOrder(conditions),
        leafCounts,
      ),
    },
  };
}

/**
 * Re-render the public callout from current database state and edit it in
 * place. Best-effort throughout: a failed edit is logged and never
 * propagated, because every caller has already committed its money movement.
 */
export async function refreshDareCallout(
  dareId: number,
  deps: DareDiscordDependencies = defaultDareDiscordDependencies,
): Promise<void> {
  await runSerialized(`dare:${dareId.toString()}`, async () => {
    try {
      const state = await loadDareCalloutState(deps.prismaClient, dareId);
      if (state?.messageRef == null) return;
      const ref = BucksMessageRefSchema.parse(JSON.parse(state.messageRef));
      try {
        await observeBucksDelivery(
          {
            surface: "dare_update",
            operation: "edit",
            serverId: state.serverId,
            channelId: ref.channelId,
          },
          () =>
            deps.editMessage({
              channelId: DiscordChannelIdSchema.parse(ref.channelId),
              messageId: ref.messageId,
              options: {
                content: dareCalloutContent(state.view),
                allowedMentions: { parse: [] },
                components: dareCalloutComponents(state.dareState, dareId),
              },
            }),
        );
      } catch (error) {
        logger.warn(
          `⚠️ Could not edit dare callout ${ref.messageId} for dare ${dareId.toString()}:`,
          error,
        );
      }
    } catch (error) {
      logger.error(
        `❌ Could not prepare dare callout refresh for ${dareId.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: { source: "betting-dare-refresh", dareId: dareId.toString() },
      });
    }
  });
}

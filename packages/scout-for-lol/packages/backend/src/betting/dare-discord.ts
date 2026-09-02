import * as Sentry from "@sentry/bun";
import { MessageFlags, type InteractionReplyOptions } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  formatInteger,
  type BucksDareState,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  BUCKS_GUILD_ONLY,
  BUCKS_INVALID_STAKE,
  bucksInsufficient,
} from "#src/betting/copy.ts";
import {
  dareCalloutComponents,
  defaultDareDiscordDependencies,
  loadDareCalloutState,
  persistDareCalloutRef,
  refreshDareCallout,
  type DareDiscordDependencies,
} from "#src/betting/dare-callout.ts";
import {
  DARES_NOT_ENABLED,
  dareAcceptAckContent,
  dareCalloutContent,
  dareChickenContent,
  dareConfirmedPostedContent,
  dareContributionAckContent,
} from "#src/betting/dare-copy.ts";
import type {
  AcceptDareResult,
  DeclineDareResult,
} from "#src/betting/dare-accept.ts";
import type { ContributeToDareResult } from "#src/betting/dare-contribute.ts";
import type {
  AbandonDareResult,
  ConfirmDareResult,
} from "#src/betting/dare-create.ts";
import { parseDareCustomId } from "#src/betting/dare-custom-id.ts";
import { observeBucksDelivery } from "#src/betting/delivery-observability.ts";
import type { DareButtonInteractionBase } from "#src/betting/dare-button-interaction.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("betting-dare-discord");

/**
 * The dare button handler.
 *
 * Authorization is SERVER-SIDE: the custom ID carries only a key, so who may
 * click which button is decided against the stored dare row, never trusted
 * from the component. A wrong clicker gets a fresh ephemeral reply
 * (navigation precedent); an authorized clicker gets a silent `deferUpdate`,
 * the domain call, and a serialized in-place edit of the public callout read
 * back from the database. Every send and edit is wrapped in
 * `observeBucksDelivery`, and a delivery failure never rolls back committed
 * money movement (transfer-receipt precedent).
 */

const DARE_NOT_FOUND = "🤷 That dare no longer exists.";
const TARGETS_CANNOT_CONTRIBUTE =
  "🎯 You're a target of this dare — targets risk nothing and can't fund their own bounty.";

/**
 * Structural (bet-button precedent): discord.js's real `ButtonInteraction`
 * satisfies this shape, so the router passes the live object with no cast and
 * tests build plain objects.
 */
export type DareButtonInteraction = DareButtonInteractionBase & {
  followUp: (options: InteractionReplyOptions) => Promise<unknown>;
};

/** Wrong clicker (or dead dare): a fresh ephemeral reply, never a touch of
 * the message the button lives on. */
async function refuse(
  interaction: DareButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply({ content });
}

/** Private feedback after the authorized path acknowledged with
 * `deferUpdate` — `editReply` would clobber the public callout. */
async function followEphemeral(
  interaction: DareButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.followUp({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

function describeDareState(dareState: BucksDareState): string {
  switch (dareState) {
    case "proposed":
      return "still waiting to be confirmed";
    case "pending_accept":
      return "already confirmed and waiting on the targets";
    case "active":
      return "already live";
    case "achieved":
      return "over — the targets pulled it off";
    case "unachieved":
      return "over — the dare survived";
    case "declined":
      return "over — a target chickened out";
    case "expired":
      return "over — the accept window lapsed";
    case "voided":
      return "over — it was voided and refunded";
    case "abandoned":
      return "cancelled";
  }
}

function describeConfirmFailure(
  result: Exclude<ConfirmDareResult, { kind: "confirmed" }>,
): string {
  switch (result.kind) {
    case "feature_disabled":
      return DARES_NOT_ENABLED;
    case "not_found":
      return DARE_NOT_FOUND;
    case "not_challenger":
      return "Only the challenger can confirm this dare.";
    case "proposal_expired":
      return "⌛ This proposal expired before it was confirmed. Run `/bb dare` again.";
    case "already_resolved":
      return `This dare is ${describeDareState(result.dareState)}.`;
    case "insufficient":
      return bucksInsufficient(result.balance, result.needed);
    case "callout_too_long":
      return "This dare has too many targets or conditions to fit in one Discord message — try fewer targets or a simpler condition, then run `/bb dare` again.";
  }
}

type DareClickContext = {
  serverId: DiscordGuildId;
  clickerId: ReturnType<typeof DiscordAccountIdSchema.parse>;
  channelId: DiscordChannelId;
  challengerDiscordId: string;
};

async function handleConfirm(
  interaction: DareButtonInteraction,
  dareId: number,
  context: DareClickContext,
  deps: DareDiscordDependencies,
): Promise<void> {
  const result = await deps.confirm({
    dareId,
    serverId: context.serverId,
    challengerDiscordId: context.clickerId,
  });
  if (result.kind !== "confirmed") {
    // Insufficient funds keeps the buttons so the challenger can retry after
    // earning; every other refusal is terminal for this confirmation.
    const terminal =
      result.kind === "insufficient" ? {} : { components: [], embeds: [] };
    await interaction.editReply({
      content: describeConfirmFailure(result),
      ...terminal,
    });
    return;
  }
  // The stake is committed; everything past here is delivery and must never
  // roll it back. The confirm button lives on the EPHEMERAL confirmation, so
  // a followUp would inherit that ephemerality — the public callout goes
  // through a plain channel send to the dare's stored channel instead.
  let message: { channelId: string; id: string };
  try {
    const state = await loadDareCalloutState(deps.prismaClient, dareId);
    if (state === undefined) {
      throw new Error(
        `Dare ${dareId.toString()} disappeared after its confirm committed`,
      );
    }
    message = await observeBucksDelivery(
      {
        surface: "dare_callout",
        operation: "send",
        serverId: context.serverId,
        channelId: context.channelId,
      },
      () =>
        deps.sendMessage(
          {
            content: dareCalloutContent(state.view),
            components: dareCalloutComponents(state.dareState, dareId),
            allowedMentions: {
              parse: [],
              users: state.view.targets.map((target) => target.discordId),
            },
          },
          context.channelId,
          context.serverId,
        ),
    );
  } catch (error) {
    logger.error(
      `❌ Could not post the callout for confirmed dare ${dareId.toString()}:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "betting-dare-callout", dareId: dareId.toString() },
    });
    await interaction.editReply({
      content:
        "Dare confirmed and your stake is in, but I could not post the public callout. Nothing was reversed.",
      components: [],
      embeds: [],
    });
    return;
  }
  // The callout EXISTS from here on — a failure below is a persistence
  // problem, not a send problem, and the challenger must not be told the
  // callout was never posted. Without the stored ref the serialized refresh
  // skips this dare forever, so the persist gets one retry and an accurate
  // degraded message when it still fails.
  const persisted = await persistDareCalloutRef(deps.prismaClient, dareId, {
    channelId: message.channelId,
    messageId: message.id,
  });
  await interaction.editReply({
    content: persisted
      ? dareConfirmedPostedContent({
          potTotal: result.potTotal,
          acceptDeadline: result.acceptDeadline,
        })
      : "✅ Dare confirmed and the callout was posted, but live pot/progress updates on it may lag. Nothing was reversed.",
    components: [],
    embeds: [],
  });
}

async function handleCancel(
  interaction: DareButtonInteraction,
  dareId: number,
  context: DareClickContext,
  deps: DareDiscordDependencies,
): Promise<void> {
  const result = await deps.abandon({
    dareId,
    serverId: context.serverId,
    challengerDiscordId: context.clickerId,
  });
  await interaction.editReply({
    content: describeCancelResult(result),
    components: [],
    embeds: [],
  });
}

function describeCancelResult(result: AbandonDareResult): string {
  switch (result.kind) {
    case "abandoned":
      return "🗑️ Dare cancelled — nothing was debited.";
    case "already_resolved":
      return `This dare is ${describeDareState(result.dareState)}.`;
    case "not_challenger":
      return "Only the challenger can cancel this dare.";
    case "not_found":
      return DARE_NOT_FOUND;
  }
}

function describeAcceptFailure(
  result: Exclude<AcceptDareResult, { kind: "accepted" }>,
): string {
  switch (result.kind) {
    case "feature_disabled":
      return DARES_NOT_ENABLED;
    case "already_accepted":
      return "You already accepted this dare.";
    case "accept_window_expired":
      return "⌛ The accept window already lapsed.";
    case "already_resolved":
      return `This dare is ${describeDareState(result.dareState)}.`;
    case "not_a_target":
      return "Only a dared player can accept this dare.";
    case "not_found":
      return DARE_NOT_FOUND;
  }
}

function describeDeclineFailure(
  result: Exclude<DeclineDareResult, { kind: "declined" }>,
): string {
  switch (result.kind) {
    case "already_accepted":
      return "You already accepted — no chickening out now.";
    case "already_resolved":
      return `This dare is ${describeDareState(result.dareState)}.`;
    case "not_a_target":
      return "Only a dared player can decline this dare.";
    case "not_found":
      return DARE_NOT_FOUND;
  }
}

function describeContributeFailure(
  result: Exclude<ContributeToDareResult, { kind: "contributed" }>,
): string {
  switch (result.kind) {
    case "feature_disabled":
      return DARES_NOT_ENABLED;
    case "invalid_amount":
      return BUCKS_INVALID_STAKE;
    case "target_cannot_contribute":
      return TARGETS_CANNOT_CONTRIBUTE;
    case "too_late":
      return `⏰ Too late — this dare is ${describeDareState(result.dareState)}.`;
    case "insufficient":
      return bucksInsufficient(result.balance, result.needed);
    case "pot_full":
      return `This dare's pot is already at ${formatInteger(result.potTotal)} BB — it can't hold any more.`;
    case "not_found":
      return DARE_NOT_FOUND;
  }
}

async function handleAccept(
  interaction: DareButtonInteraction,
  dareId: number,
  context: DareClickContext,
  deps: DareDiscordDependencies,
): Promise<void> {
  const result = await deps.accept({
    dareId,
    serverId: context.serverId,
    targetDiscordId: context.clickerId,
  });
  if (result.kind === "accepted") {
    await refreshDareCallout(dareId, deps);
    await followEphemeral(
      interaction,
      dareAcceptAckContent({
        activated: result.activated,
        acceptedCount: result.acceptedCount,
        targetCount: result.targetCount,
        horizonKind: result.horizonKind,
        windowEndsAt: result.windowEndsAt,
      }),
    );
    return;
  }
  await followEphemeral(interaction, describeAcceptFailure(result));
}

async function handleDecline(
  interaction: DareButtonInteraction,
  dareId: number,
  context: DareClickContext,
  deps: DareDiscordDependencies,
): Promise<void> {
  const result = await deps.decline({
    dareId,
    serverId: context.serverId,
    targetDiscordId: context.clickerId,
  });
  if (result.kind === "declined") {
    // Refunds are committed; the chicken announcement and the callout edit
    // are delivery only and never roll them back.
    try {
      await observeBucksDelivery(
        {
          surface: "dare_result",
          operation: "send",
          serverId: context.serverId,
          channelId: context.channelId,
        },
        () =>
          deps.sendMessage(
            {
              content: dareChickenContent({
                declinerDiscordId: context.clickerId,
                potTotal: result.potTotal,
              }),
              allowedMentions: {
                parse: [],
                users: [context.clickerId, context.challengerDiscordId],
              },
            },
            context.channelId,
            context.serverId,
          ),
      );
    } catch (error) {
      logger.warn(
        `⚠️ Could not post the chicken message for dare ${dareId.toString()}:`,
        error,
      );
    }
    await refreshDareCallout(dareId, deps);
    return;
  }
  await followEphemeral(interaction, describeDeclineFailure(result));
}

async function handleContribute(
  interaction: DareButtonInteraction,
  input: { dareId: number; amount: number },
  context: DareClickContext,
  deps: DareDiscordDependencies,
): Promise<void> {
  const result = await deps.contribute({
    dareId: input.dareId,
    serverId: context.serverId,
    contributorDiscordId: context.clickerId,
    amount: input.amount,
  });
  if (result.kind === "contributed") {
    await refreshDareCallout(input.dareId, deps);
    await followEphemeral(
      interaction,
      dareContributionAckContent({
        amount: result.amount,
        potTotal: result.potTotal,
        balanceAfter: result.balanceAfter,
      }),
    );
    return;
  }
  await followEphemeral(interaction, describeContributeFailure(result));
}

/**
 * Handle one dare button click. The router has already claimed the `bbd:`
 * namespace and closed out unparseable IDs, so an undefined parse here is a
 * silent return (bet-button precedent).
 */
export async function handleDareButton(
  interaction: DareButtonInteraction,
  deps: DareDiscordDependencies = defaultDareDiscordDependencies,
): Promise<void> {
  const parsed = parseDareCustomId(interaction.customId);
  if (parsed === undefined) {
    return;
  }
  if (interaction.guildId === null) {
    await refuse(interaction, BUCKS_GUILD_ONLY);
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  const clickerId = DiscordAccountIdSchema.parse(interaction.user.id);
  const dare = await deps.prismaClient.bucksDare.findUnique({
    where: { id: parsed.dareId },
    select: {
      serverId: true,
      channelId: true,
      challengerDiscordId: true,
      targets: { select: { discordId: true } },
    },
  });
  if (dare?.serverId !== serverId) {
    await refuse(interaction, DARE_NOT_FOUND);
    return;
  }
  const isTarget = dare.targets.some(
    (target) => target.discordId === clickerId,
  );
  if (
    clickerId !== dare.challengerDiscordId &&
    (parsed.action === "c" || parsed.action === "n")
  ) {
    await refuse(interaction, "Only the challenger can use these buttons.");
    return;
  }
  if (!isTarget && (parsed.action === "a" || parsed.action === "d")) {
    await refuse(interaction, "Only a dared player can answer this dare.");
    return;
  }
  if (isTarget && parsed.action === "p") {
    await refuse(interaction, TARGETS_CANNOT_CONTRIBUTE);
    return;
  }

  // Authorized: acknowledge silently and act. All public output goes through
  // the serialized callout refresh; private feedback is an ephemeral followUp.
  await interaction.deferUpdate();
  const context: DareClickContext = {
    serverId,
    clickerId,
    channelId: DiscordChannelIdSchema.parse(dare.channelId),
    challengerDiscordId: dare.challengerDiscordId,
  };
  switch (parsed.action) {
    case "c":
      await handleConfirm(interaction, parsed.dareId, context, deps);
      return;
    case "n":
      await handleCancel(interaction, parsed.dareId, context, deps);
      return;
    case "a":
      await handleAccept(interaction, parsed.dareId, context, deps);
      return;
    case "d":
      await handleDecline(interaction, parsed.dareId, context, deps);
      return;
    case "p":
      await handleContribute(
        interaction,
        { dareId: parsed.dareId, amount: parsed.amount },
        context,
        deps,
      );
  }
}

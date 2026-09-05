import {
  championNameToDisplayName,
  formatInteger,
  formatParlayNumericValue,
  type BucksDareHorizonKind,
  type BucksDareState,
} from "@scout-for-lol/data";
import { withRulesHint } from "#src/betting/copy.ts";
import {
  DARE_RATE_LABELS,
  formatDareRateThreshold,
  type DareLeaf,
} from "#src/betting/dares/evaluation/dare-criteria.ts";
import type {
  DareContributorRefund,
  DareTargetPayout,
} from "#src/betting/dares/settlement/dare-ledger.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-shared.ts";
import {
  PARTICIPANT_BOOLEAN_CATALOG,
  PARTICIPANT_NUMERIC_CATALOG,
} from "#src/betting/parlays/parlay-catalog.ts";
import { countLabel } from "#src/betting/weekly/weekly-parlay-discord-copy.ts";

/**
 * Pure copy builders for every dare Discord surface.
 *
 * No Discord imports and no I/O (weekly-parlay-discord-copy precedent): every
 * function turns frozen facts into a string, so the exact user-visible text is
 * pinned by plain unit tests. The condition text is ALWAYS the code-rendered
 * `conditionSummary` — model prose never reaches a message. Numbers, not
 * rules: only `/bb rules` explains the cut, the windows, and the refund
 * policy; these surfaces show amounts and deadlines and point there.
 */

export const DARES_NOT_ENABLED =
  "🚫 Bryan Bucks dares aren't enabled in this server.";

function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000).toString()}:R>`;
}

function bb(amount: number): string {
  return `**${formatInteger(amount)} BB**`;
}

function dareHorizonPhrase(
  horizonKind: BucksDareHorizonKind,
  windowDays: number | null,
): string {
  if (horizonKind === "next_game") {
    return "their next eligible game";
  }
  return `**${formatInteger(windowDays ?? 0)} ${countLabel(windowDays ?? 0, "day")}** from the moment every target accepts`;
}

/** The ephemeral confirmation the challenger approves — description text for
 * the embed `/bb dare` shows above its Confirm / Cancel buttons. */
export function dareConfirmationContent(input: {
  amount: number;
  targetAliases: readonly string[];
  conditionSummary: string;
  horizonKind: BucksDareHorizonKind;
  windowDays: number | null;
  proposalExpiresAt: Date;
}): string {
  return [
    "**The dare:**",
    input.conditionSummary,
    "",
    `**Horizon:** ${dareHorizonPhrase(input.horizonKind, input.windowDays)}`,
    `**Opening pot:** ${bb(input.amount)} — debited from your wallet when you confirm.`,
    `**Targets:** ${input.targetAliases.join(", ")} — they risk nothing and must all accept before it goes live.`,
    // Numbers only; the cut, windows, and refund policy live in /bb rules.
    withRulesHint(`Confirm before ${relative(input.proposalExpiresAt)}.`),
  ].join("\n");
}

/** The ephemeral confirm message after the callout was posted. */
export function dareConfirmedPostedContent(input: {
  potTotal: number;
  acceptDeadline: Date;
}): string {
  return `✅ Dare confirmed — ${bb(input.potTotal)} in the pot. Callout posted; every target must accept ${relative(input.acceptDeadline)}.`;
}

/**
 * Ephemeral acknowledgement after a target accepts.
 *
 * A next-game dare settles win-or-lose on the FIRST eligible game; its stored
 * clock is only the no-game backstop, so the copy must not present it as when
 * the dare "ends".
 */
export function dareAcceptAckContent(input: {
  activated: boolean;
  acceptedCount: number;
  targetCount: number;
  horizonKind: BucksDareHorizonKind;
  windowEndsAt: Date | undefined;
}): string {
  if (input.activated) {
    if (input.horizonKind === "next_game") {
      const backstop =
        input.windowEndsAt === undefined
          ? ""
          : ` (expires ${relative(input.windowEndsAt)} if no game is played)`;
      return `🔥 You're all in. The dare is LIVE — it settles on your next eligible game${backstop}.`;
    }
    const until =
      input.windowEndsAt === undefined
        ? ""
        : ` — it ends ${relative(input.windowEndsAt)}`;
    return `🔥 You're all in. The dare is LIVE${until}.`;
  }
  return `✅ Accepted (${formatInteger(input.acceptedCount)}/${formatInteger(input.targetCount)}). Waiting on the rest.`;
}

/** Ephemeral acknowledgement after a pot contribution. */
export function dareContributionAckContent(input: {
  amount: number;
  potTotal: number;
  balanceAfter: number;
}): string {
  return `💰 +${bb(input.amount)} onto the pot — now ${bb(input.potTotal)}. Balance ${bb(input.balanceAfter)}.`;
}

export type DareCalloutTarget = {
  discordId: string;
  alias: string;
  accepted: boolean;
  declined: boolean;
};

export type DareLeafProgress = {
  label: string;
  count: number;
  requiredGames: number;
};

export type DareCalloutView = {
  dareState: BucksDareState;
  challengerDiscordId: string;
  potTotal: number;
  conditionSummary: string;
  horizonKind: BucksDareHorizonKind;
  targets: readonly DareCalloutTarget[];
  acceptDeadline: Date | null;
  windowEndsAt: Date | null;
  progress: readonly DareLeafProgress[];
};

function comparisonSymbol(operator: "gte" | "lte" | "eq"): string {
  if (operator === "gte") return "≥";
  if (operator === "lte") return "≤";
  return "exactly";
}

function championSuffix(champion: string | null): string {
  if (champion === null) return "";
  return ` on ${championNameToDisplayName(champion)}`;
}

/** Compact per-leaf progress label, e.g. "Wins" or "Games with ≥ 10 kills". */
export function dareLeafProgressLabel(leaf: DareLeaf): string {
  const suffix = championSuffix(leaf.champion);
  const predicate = leaf.predicate;
  if (predicate.kind === "participant_boolean") {
    if (predicate.field === "win") {
      return `${predicate.expected ? "Wins" : "Winless games"}${suffix}`;
    }
    const label = PARTICIPANT_BOOLEAN_CATALOG[predicate.field].label;
    return predicate.expected
      ? `Games with ${label}${suffix}`
      : `Games without ${label}${suffix}`;
  }
  if (predicate.kind === "participant_numeric") {
    return `Games with ${comparisonSymbol(predicate.operator)} ${formatParlayNumericValue(predicate.field, predicate.threshold)} ${PARTICIPANT_NUMERIC_CATALOG[predicate.field].label}${suffix}`;
  }
  return `Games with ${comparisonSymbol(predicate.operator)} ${formatDareRateThreshold(predicate.thresholdScaled)} ${DARE_RATE_LABELS[predicate.field]}${suffix}`;
}

/** Pair the canonical leaves with their qualifying-game counts. */
export function dareLeafProgress(
  leaves: readonly DareLeaf[],
  leafCounts: readonly number[],
): DareLeafProgress[] {
  return leaves.map((leaf, index) => ({
    label: dareLeafProgressLabel(leaf),
    count: leafCounts[index] ?? 0,
    requiredGames: leaf.requiredGames,
  }));
}

export function dareProgressLine(progress: DareLeafProgress): string {
  return `• ${progress.label}: ${formatInteger(progress.count)}/${formatInteger(progress.requiredGames)}`;
}

function checklistLine(target: DareCalloutTarget): string {
  if (target.declined) return `• 🐔 <@${target.discordId}> — declined`;
  if (target.accepted) return `• ✅ <@${target.discordId}> — accepted`;
  return `• ⏳ <@${target.discordId}>`;
}

const FINAL_HEADERS: Partial<Record<BucksDareState, string>> = {
  achieved: "✅ **Bryan Bucks dare: ACHIEVED**",
  unachieved: "🛡️ **Bryan Bucks dare: THE DARE SURVIVED**",
  declined: "🐔 **Bryan Bucks dare: CHICKENED OUT**",
  expired: "⌛ **Bryan Bucks dare: EXPIRED**",
  voided: "↩️ **Bryan Bucks dare: VOIDED**",
  abandoned: "🗑️ **Bryan Bucks dare: WITHDRAWN**",
  proposed: "🗑️ **Bryan Bucks dare: WITHDRAWN**",
};

/**
 * Discord's hard message content limit.
 * @see https://discord.com/developers/docs/resources/channel#create-message
 *
 * A local constant rather than an import from `discord/utils/message.ts` —
 * `prematch-line.ts` establishes the same precedent in this package: the
 * betting layer's copy modules declare their own budget rather than reaching
 * into `discord/` for one number.
 */
export const DARE_CALLOUT_MAX_LENGTH = 2000;

/**
 * The single public callout message, rendered from current database state.
 * The same message is edited in place through every transition, so this
 * covers the whole lifecycle: awaiting consent, LIVE with progress, and the
 * terminal states (which the result message announces in detail).
 */
export function dareCalloutContent(view: DareCalloutView): string {
  const dare = ["**The dare:**", view.conditionSummary];
  if (view.dareState === "pending_accept") {
    const deadline =
      view.acceptDeadline === null
        ? ":"
        : ` — every target must accept ${relative(view.acceptDeadline)}:`;
    return [
      `🎯 **Bryan Bucks dare** — <@${view.challengerDiscordId}> put ${bb(view.potTotal)} on it`,
      ...dare,
      `**Accept checklist**${deadline}`,
      ...view.targets.map((target) => checklistLine(target)),
      withRulesHint(
        "Targets risk nothing. Anyone else can pile onto the pot below — contributions are final.",
      ),
    ].join("\n");
  }
  if (view.dareState === "active") {
    // A next-game dare settles on the FIRST eligible game; its stored clock
    // is only the no-game backstop and must not read as an "ends" date.
    const ends =
      view.windowEndsAt === null
        ? ""
        : view.horizonKind === "next_game"
          ? `, settles on the next eligible game (expires ${relative(view.windowEndsAt)} if none is played)`
          : `, ends ${relative(view.windowEndsAt)}`;
    return [
      `🔴 **Bryan Bucks dare: LIVE** — ${bb(view.potTotal)} on the line${ends}`,
      ...dare,
      "**Progress:**",
      ...view.progress.map((progress) => dareProgressLine(progress)),
      withRulesHint("Pile onto the pot below — contributions are final."),
    ].join("\n");
  }
  const decliner =
    view.dareState === "declined"
      ? view.targets.find((target) => target.declined)
      : undefined;
  const declineNote =
    decliner === undefined ? "" : ` — <@${decliner.discordId}> declined.`;
  return [
    FINAL_HEADERS[view.dareState] ?? "🎯 **Bryan Bucks dare**",
    "**The dare was:**",
    view.conditionSummary,
    `Pot: ${bb(view.potTotal)}${declineNote}`,
  ].join("\n");
}

/** Public chicken message, sent when a target declines via the button. */
export function dareChickenContent(input: {
  declinerDiscordId: string;
  potTotal: number;
}): string {
  return [
    "🐔 **Bryan Bucks dare: CHICKENED OUT**",
    `<@${input.declinerDiscordId}> declined the dare. The pot's ${bb(input.potTotal)} went back to the contributors in full.`,
  ].join("\n");
}

export function dareExpiredContent(input: { potTotal: number }): string {
  return [
    "⌛ **Bryan Bucks dare: EXPIRED**",
    `Not every target accepted in time. The pot's ${bb(input.potTotal)} went back to the contributors in full.`,
  ].join("\n");
}

function payoutLine(payout: DareTargetPayout): string {
  const fee =
    payout.fee > 0 ? ` · **${formatInteger(payout.fee)} BB** fee` : "";
  return `• **${payout.alias}** <@${payout.discordId}> — +${bb(payout.net)}${fee}`;
}

export function dareAchievedContent(input: {
  challengerDiscordId: string;
  conditionSummary: string;
  potTotal: number;
  payouts: readonly DareTargetPayout[];
}): string {
  return [
    "✅ **Bryan Bucks dare: ACHIEVED**",
    input.conditionSummary,
    // The challenger funded this pot but — unlike every unachieved/voided
    // refund, and unlike every winning target's payout line — never
    // appears in the achieved message's own text. `mentionUserIds`
    // ALLOWS a ping; it does not create one, so without this line the
    // person whose contribution just paid out gets no notification at all.
    `Funded by <@${input.challengerDiscordId}>. The ${bb(input.potTotal)} pot pays out:`,
    ...input.payouts.map((payout) => payoutLine(payout)),
  ].join("\n");
}

function refundLine(refund: DareContributorRefund): string {
  const fee =
    refund.fee > 0 ? ` · **${formatInteger(refund.fee)} BB** fee` : "";
  return `• <@${refund.discordId}> — ${bb(refund.refunded)} back${fee}`;
}

export function dareUnachievedContent(input: {
  conditionSummary: string;
  refunds: readonly DareContributorRefund[];
}): string {
  return [
    "🛡️ **Bryan Bucks dare: THE DARE SURVIVED**",
    input.conditionSummary,
    "Contributors got their BB back:",
    ...input.refunds.map((refund) => refundLine(refund)),
  ].join("\n");
}

export function dareVoidedContent(input: {
  refunds: readonly DareContributorRefund[];
  voidReason: string | undefined;
}): string {
  const reason =
    input.voidReason === "unknown_evaluator"
      ? "Scout can no longer evaluate this dare's stored conditions."
      : input.voidReason === "storage_overflow"
        ? "A payout would not fit in a target's wallet."
        : input.voidReason === "target_unavailable"
          ? "A frozen target account is no longer available to evaluate."
          : "This dare was voided.";
  return [
    "↩️ **Bryan Bucks dare: VOIDED**",
    reason,
    "Contributions returned in full:",
    ...input.refunds.map((refund) => refundLine(refund)),
  ].join("\n");
}

/**
 * One result message per resolved settlement summary, with its restricted
 * mention allowlist. `captured` and `abandoned` produce no result message —
 * capture only refreshes the callout, and an abandoned proposal held no money
 * and was never public.
 */
export function dareResultMessage(
  summary: DareSettlementSummary,
): { content: string; mentionUserIds: string[] } | undefined {
  if (summary.resolution === "captured" || summary.resolution === "abandoned") {
    return undefined;
  }
  if (summary.resolution === "achieved") {
    return {
      content: dareAchievedContent({
        challengerDiscordId: summary.challengerDiscordId,
        conditionSummary: summary.conditionSummary,
        potTotal: summary.potTotal,
        payouts: summary.payouts,
      }),
      mentionUserIds: [
        ...new Set([
          ...summary.payouts.map((payout) => payout.discordId),
          summary.challengerDiscordId,
        ]),
      ],
    };
  }
  const contributorIds = [
    ...new Set(summary.refunds.map((refund) => refund.discordId)),
  ];
  if (summary.resolution === "unachieved") {
    return {
      content: dareUnachievedContent({
        conditionSummary: summary.conditionSummary,
        refunds: summary.refunds,
      }),
      mentionUserIds: contributorIds,
    };
  }
  if (summary.resolution === "expired") {
    return {
      content: dareExpiredContent({ potTotal: summary.potTotal }),
      mentionUserIds: contributorIds,
    };
  }
  return {
    content: dareVoidedContent({
      refunds: summary.refunds,
      voidReason: summary.voidReason,
    }),
    mentionUserIds: contributorIds,
  };
}

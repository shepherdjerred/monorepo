import { formatInteger, type BucksDareState } from "@scout-for-lol/data";
import type { DareResultAnnouncement } from "#src/betting/dares/presentation/notify/dare-status-message.ts";

/**
 * Discord's hard message content limit.
 * @see https://discord.com/developers/docs/resources/channel#create-message
 *
 * A local constant rather than an import from `discord/utils/message.ts`: the
 * betting layer's copy modules declare their own budget rather than reaching
 * into `discord/` for one number.
 */
export const DARE_CALLOUT_MAX_LENGTH = 2000;

export const DARES_NOT_ENABLED =
  "🚫 Bryan Bucks dares aren't enabled in this server.";

/** Discord accepts at most this many explicit user mentions per message. */
const MAX_RESULT_MENTION_USERS = 100;

type DareCalloutTarget = {
  alias: string;
  acceptedAt: Date | null;
  declinedAt: Date | null;
};

export type DareCalloutContribution = {
  discordId: string;
  amount: number;
};

function pileOnContributions(
  contributions: readonly DareCalloutContribution[],
): DareCalloutContribution[] {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const contribution of contributions.slice(1)) {
    const current = totals.get(contribution.discordId);
    if (current === undefined) order.push(contribution.discordId);
    totals.set(contribution.discordId, (current ?? 0) + contribution.amount);
  }
  return order.map((discordId) => {
    const amount = totals.get(discordId);
    if (amount === undefined) {
      throw new Error(`Missing pile-on total for ${discordId}.`);
    }
    return { discordId, amount };
  });
}

function renderPileOnLines(
  contributions: readonly DareCalloutContribution[],
  visibleCount: number,
): string[] {
  const visible = contributions.slice(0, visibleCount);
  const hidden = contributions.length - visible.length;
  return [
    "**Pile-ons:**",
    ...(visible.length === 0
      ? ["None yet."]
      : visible.map(
          (contribution) =>
            `<@${contribution.discordId}> — **${formatInteger(contribution.amount)} BB**`,
        )),
    ...(hidden === 0
      ? []
      : [`…and ${formatInteger(hidden)} more contributor(s).`]),
  ];
}

function renderWithinDiscordLimit(input: {
  baseLines: readonly string[];
  pileOns: readonly DareCalloutContribution[];
  enforceDiscordLimit: boolean;
}): { content: string; visibleCount: number } {
  const fullContent = [
    ...input.baseLines,
    ...renderPileOnLines(input.pileOns, input.pileOns.length),
  ].join("\n");
  if (!input.enforceDiscordLimit) {
    return { content: fullContent, visibleCount: input.pileOns.length };
  }
  for (
    let visibleCount = input.pileOns.length;
    visibleCount >= 0;
    visibleCount--
  ) {
    const content = [
      ...input.baseLines,
      ...renderPileOnLines(input.pileOns, visibleCount),
    ].join("\n");
    if (content.length <= DARE_CALLOUT_MAX_LENGTH) {
      return { content, visibleCount };
    }
  }
  throw new Error(
    `Dare callout exceeds Discord's ${DARE_CALLOUT_MAX_LENGTH.toString()}-character limit.`,
  );
}

export type DareCalloutInput = {
  id: number;
  challengerDiscordId: string;
  openingStake: number;
  potTotal: number;
  contributions: readonly DareCalloutContribution[];
  targetAliases: readonly string[];
  revision: number;
  plainLanguage: string;
  evidenceCount: number;
  progressSummary: string;
  state: BucksDareState;
  targets: readonly DareCalloutTarget[];
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  finalValue: boolean | null;
  voidReason: string | null;
  enforceDiscordLimit?: boolean;
};

function statusText(input: {
  state: BucksDareState;
  targets: readonly DareCalloutTarget[];
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  finalValue: boolean | null;
  voidReason: string | null;
}): string {
  if (input.state === "pending_accept") {
    const decisions = input.targets
      .map((target) => {
        const state =
          target.declinedAt === null
            ? target.acceptedAt === null
              ? "waiting"
              : "accepted"
            : "declined";
        return `${target.alias}: ${state}`;
      })
      .join(" · ");
    const deadline =
      input.acceptDeadline === null
        ? ""
        : ` · closes <t:${Math.floor(input.acceptDeadline.getTime() / 1000).toString()}:R>`;
    return `Waiting for targets — ${decisions}${deadline}`;
  }
  if (input.state === "active") {
    return input.deadlineAt === null
      ? "Active"
      : `Active · ends <t:${Math.floor(input.deadlineAt.getTime() / 1000).toString()}:R>`;
  }
  if (input.state === "achieved") return "Achieved — the proof paid out.";
  if (input.state === "unachieved")
    return "Unachieved — contributor refunds settled.";
  if (input.state === "voided") {
    return `Voided with full refunds${input.voidReason === null ? "" : ` — ${input.voidReason.replaceAll("_", " ")}`}.`;
  }
  if (input.state === "declined")
    return "Declined — every contribution was fully refunded.";
  if (input.state === "expired")
    return "Acceptance expired — every contribution was fully refunded.";
  if (input.state === "cancelled")
    return "Cancelled — every contribution was fully refunded.";
  return input.finalValue === null ? input.state : String(input.finalValue);
}

export function renderDareCallout(input: DareCalloutInput): {
  content: string;
  contributorDiscordIds: string[];
} {
  const pileOns = pileOnContributions(input.contributions);
  const rendered = renderWithinDiscordLimit({
    baseLines: [
      `🎯 **Scout Dare #${input.id.toString()}**`,
      `<@${input.challengerDiscordId}> put **${formatInteger(input.openingStake)} BB** on ${input.targetAliases.join(", ")}.`,
      `Pot: **${formatInteger(input.potTotal)} BB**`,
      "",
      `**Contract · revision ${input.revision.toString()}**`,
      input.plainLanguage,
      "",
      `**Progress** · ${input.progressSummary} (${formatInteger(input.evidenceCount)} evidence games)`,
      `**Status** · ${statusText(input)}`,
    ],
    pileOns,
    enforceDiscordLimit: input.enforceDiscordLimit ?? true,
  });
  return {
    content: rendered.content,
    contributorDiscordIds: pileOns
      .slice(0, rendered.visibleCount)
      .map((contribution) => contribution.discordId),
  };
}

export function dareCalloutContent(input: DareCalloutInput): string {
  return renderDareCallout(input).content;
}

function resultAmount(amount: number): string {
  return `**${formatInteger(amount)} BB**`;
}

function resultFee(fee: number): string {
  return fee > 0 ? ` · ${resultAmount(fee)} fee` : "";
}

const VOID_REASON_COPY: Readonly<Record<string, string>> = {
  missing_evidence: "Required evidence was incomplete.",
  invalid_contract: "Scout can no longer read this dare's stored contract.",
  unknown_evaluator:
    "Scout can no longer evaluate this dare's stored conditions.",
  storage_overflow: "A payout would not fit in a target's wallet.",
  target_unavailable:
    "A frozen target account is no longer available to evaluate.",
  activation_timeout: "The dare could not activate in time.",
  insufficient_baseline:
    "There were not enough recent games to set the dare's baseline.",
  version_retired: "This dare's contract version was retired.",
};

type ResultLine = { text: string; discordId: string };

function resultHeader(
  dareId: number,
  result: DareResultAnnouncement,
  plainLanguage: string,
): string[] {
  const id = `#${dareId.toString()}`;
  if (result.resolution === "achieved") {
    return [
      `✅ **Scout Dare ${id}: ACHIEVED**`,
      plainLanguage,
      // The challenger funded the pot but appears in no payout line, and an
      // allowlisted mention only pings a user the text actually names.
      `Funded by <@${result.challengerDiscordId}>. The ${resultAmount(result.potTotal)} pot pays out:`,
    ];
  }
  if (result.resolution === "unachieved") {
    return [
      `🛡️ **Scout Dare ${id}: THE DARE SURVIVED**`,
      plainLanguage,
      "Contributors got their BB back:",
    ];
  }
  return [
    `↩️ **Scout Dare ${id}: VOIDED**`,
    (result.voidReason === null
      ? undefined
      : VOID_REASON_COPY[result.voidReason]) ?? "This dare was voided.",
    "Contributions returned in full:",
  ];
}

function resultLines(result: DareResultAnnouncement): ResultLine[] {
  if (result.resolution === "achieved") {
    return result.payouts.map((payout) => ({
      discordId: payout.discordId,
      text: `• **${payout.alias}** <@${payout.discordId}> — +${resultAmount(payout.net)}${resultFee(payout.fee)}`,
    }));
  }
  return result.refunds.map((refund) => ({
    discordId: refund.discordId,
    text: `• <@${refund.discordId}> — ${resultAmount(refund.refunded)} back${resultFee(refund.fee)}`,
  }));
}

function hiddenLinesNote(hidden: number): string[] {
  return hidden === 0 ? [] : [`…and ${formatInteger(hidden)} more.`];
}

/** `text` cut to at most `room` characters, ending in an ellipsis if cut. */
function truncateWithEllipsis(text: string, room: number): string {
  if (text.length <= room) return text;
  let cut = text.slice(0, Math.max(0, room - 1));
  // Never leave half of a surrogate pair at the cut.
  const last = cut.codePointAt(cut.length - 1);
  if (last !== undefined && last >= 0xd8_00 && last <= 0xdb_ff) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/**
 * The header with the Dare's plain-language text bounded so the header, the
 * first payout or refund line, and the count of any lines after it always fit
 * the message budget. Dares drafted before the draft-length check can carry
 * text far longer than one post; the result still has to render.
 */
function boundedResultHeader(
  dareId: number,
  result: DareResultAnnouncement,
  lines: readonly ResultLine[],
): string[] {
  const first = lines[0];
  const frame = [
    ...resultHeader(dareId, result, ""),
    ...(first === undefined ? [] : [first.text]),
    ...hiddenLinesNote(Math.max(0, lines.length - 1)),
  ].join("\n");
  return resultHeader(
    dareId,
    result,
    truncateWithEllipsis(
      result.plainLanguage,
      DARE_CALLOUT_MAX_LENGTH - frame.length,
    ),
  );
}

/**
 * The public post a resolved Dare makes in its own channel.
 *
 * Mentions are an allowlist of exactly the users the visible text names, so
 * the post pings the people whose money moved and nobody else. A pot with too
 * many contributors to fit Discord's limit names as many as fit and counts the
 * rest, rather than failing a settlement that already committed; an overlong
 * plain-language text is truncated so at least the first line always shows.
 */
export function renderDareResult(
  dareId: number,
  result: DareResultAnnouncement,
): { content: string; mentionUserIds: string[] } {
  const lines = resultLines(result);
  const header = boundedResultHeader(dareId, result, lines);
  for (let visible = lines.length; visible >= 0; visible--) {
    const hidden = lines.length - visible;
    const content = [
      ...header,
      ...lines.slice(0, visible).map((line) => line.text),
      ...hiddenLinesNote(hidden),
    ].join("\n");
    if (content.length > DARE_CALLOUT_MAX_LENGTH) continue;
    const named = [
      ...(result.resolution === "achieved" ? [result.challengerDiscordId] : []),
      ...lines.slice(0, visible).map((line) => line.discordId),
    ];
    return {
      content,
      mentionUserIds: [...new Set(named)].slice(0, MAX_RESULT_MENTION_USERS),
    };
  }
  throw new Error(
    `Dare ${dareId.toString()} result post exceeds Discord's ${DARE_CALLOUT_MAX_LENGTH.toString()}-character limit.`,
  );
}

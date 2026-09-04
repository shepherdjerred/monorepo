import { formatInteger, type BucksDareV2State } from "@scout-for-lol/data";
import { DARE_CALLOUT_MAX_LENGTH } from "#src/betting/dare-copy.ts";

type DareV2CalloutTarget = {
  alias: string;
  acceptedAt: Date | null;
  declinedAt: Date | null;
};

export type DareV2CalloutContribution = {
  discordId: string;
  amount: number;
};

function pileOnContributions(
  contributions: readonly DareV2CalloutContribution[],
): DareV2CalloutContribution[] {
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
  contributions: readonly DareV2CalloutContribution[],
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
  pileOns: readonly DareV2CalloutContribution[];
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
    `Dare v2 callout exceeds Discord's ${DARE_CALLOUT_MAX_LENGTH.toString()}-character limit.`,
  );
}

export type DareV2CalloutInput = {
  id: number;
  challengerDiscordId: string;
  openingStake: number;
  potTotal: number;
  contributions: readonly DareV2CalloutContribution[];
  targetAliases: readonly string[];
  revision: number;
  plainLanguage: string;
  evidenceCount: number;
  progressSummary: string;
  state: BucksDareV2State;
  targets: readonly DareV2CalloutTarget[];
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  finalValue: boolean | null;
  voidReason: string | null;
  enforceDiscordLimit?: boolean;
};

function statusText(input: {
  state: BucksDareV2State;
  targets: readonly DareV2CalloutTarget[];
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

export function renderDareV2Callout(input: DareV2CalloutInput): {
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

export function dareV2CalloutContent(input: DareV2CalloutInput): string {
  return renderDareV2Callout(input).content;
}

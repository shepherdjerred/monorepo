import type { BucksDareV2State } from "@scout-for-lol/data";

type DareV2CalloutTarget = {
  alias: string;
  acceptedAt: Date | null;
  declinedAt: Date | null;
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

export function dareV2CalloutContent(input: {
  id: number;
  challengerDiscordId: string;
  potTotal: number;
  targetAliases: readonly string[];
  revision: number;
  plainLanguage: string;
  evidenceCount: number;
  state: BucksDareV2State;
  targets: readonly DareV2CalloutTarget[];
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  finalValue: boolean | null;
  voidReason: string | null;
}): string {
  return [
    `🎯 **Scout Dare #${input.id.toString()}**`,
    `<@${input.challengerDiscordId}> put **${input.potTotal.toString()} BB** on ${input.targetAliases.join(", ")}.`,
    "",
    `**Contract · revision ${input.revision.toString()}**`,
    input.plainLanguage,
    "",
    `**Progress** · ${input.evidenceCount.toString()} evidence games`,
    `**Status** · ${statusText(input)}`,
  ].join("\n");
}

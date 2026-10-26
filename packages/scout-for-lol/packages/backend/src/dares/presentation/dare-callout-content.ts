import type { DareResultAnnouncement } from "#src/dares/presentation/notify/dare-status-message.ts";
import { formatInteger, type DareState } from "@scout-for-lol/data";
import { graphemePrefix } from "@shepherdjerred/text";
import { escapeMarkdown } from "discord.js";
export const DARE_CALLOUT_MAX_LENGTH = 2000;
export const DARES_NOT_ENABLED = "Dares aren't enabled in this server.";
type DareCalloutTarget = {
  alias: string;
  acceptedAt: Date | null;
  declinedAt: Date | null;
};
export type DareCalloutInput = {
  id: number;
  challengerDiscordId: string;
  targetAliases: readonly string[];
  revision: number;
  plainLanguage: string;
  evidenceCount: number;
  progressSummary: string;
  state: DareState;
  targets: readonly DareCalloutTarget[];
  acceptDeadline: Date | null;
  deadlineAt: Date | null;
  finalValue: boolean | null;
  voidReason: string | null;
  enforceDiscordLimit?: boolean;
};
function statusText(input: {
  state: DareState;
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
  if (input.state === "achieved")
    return "Achieved — verified by match evidence.";
  if (input.state === "unachieved") return "Unachieved.";
  if (input.state === "voided") {
    return `Voided${input.voidReason === null ? "" : ` — ${input.voidReason.replaceAll("_", " ")}`}.`;
  }
  if (input.state === "declined") return "Declined.";
  if (input.state === "expired") return "Acceptance expired.";
  if (input.state === "cancelled") return "Cancelled.";
  return input.finalValue === null ? input.state : String(input.finalValue);
}

export function renderDareCallout(input: DareCalloutInput): {
  content: string;
} {
  const content = [
    "🎯 **Scout Dare #" + input.id.toString() + "**",
    "<@" +
      input.challengerDiscordId +
      "> dares " +
      input.targetAliases.map((alias) => escapeMarkdown(alias)).join(", ") +
      ".",
    "",
    "**Contract · revision " + input.revision.toString() + "**",
    input.plainLanguage,
    "",
    "**Progress** · " +
      input.progressSummary +
      " (" +
      formatInteger(input.evidenceCount) +
      " evidence games)",
    "**Status** · " + statusText(input),
  ].join("\n");
  if (
    input.enforceDiscordLimit !== false &&
    content.length > DARE_CALLOUT_MAX_LENGTH
  )
    throw new Error("Dare callout exceeds Discord's content limit.");
  return { content };
}
export function dareCalloutContent(input: DareCalloutInput): string {
  return renderDareCallout(input).content;
}
export function renderDareResult(
  dareId: number,
  result: DareResultAnnouncement,
): { content: string; mentionUserIds: string[] } {
  const label =
    result.resolution === "achieved"
      ? "✅ ACHIEVED"
      : result.resolution === "unachieved"
        ? "🛡️ NOT ACHIEVED"
        : "↩️ VOIDED";
  const heading = "**Scout Dare #" + dareId.toString() + ": " + label + "**";
  const winners = result.winners.map(
    (winner) =>
      "• **" + escapeMarkdown(winner.alias) + "** <@" + winner.discordId + ">",
  );
  const footer =
    result.voidReason === null
      ? ""
      : "Voided: " + result.voidReason.replaceAll("_", " ");
  const frame = [heading, "", ...winners, footer].filter(Boolean).join("\n");
  const room = DARE_CALLOUT_MAX_LENGTH - frame.length - 1;
  const summary =
    result.plainLanguage.length <= room
      ? result.plainLanguage
      : graphemePrefix(result.plainLanguage, Math.max(0, room - 1)) + "…";
  const content = [heading, summary, ...winners, footer]
    .filter(Boolean)
    .join("\n");
  if (content.length > DARE_CALLOUT_MAX_LENGTH)
    throw new Error("Dare result exceeds Discord's content limit.");
  return {
    content,
    mentionUserIds: [
      ...new Set(result.winners.map((winner) => winner.discordId)),
    ],
  };
}

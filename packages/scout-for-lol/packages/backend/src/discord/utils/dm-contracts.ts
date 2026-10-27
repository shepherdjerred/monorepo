import type { DiscordGuildId } from "@scout-for-lol/data";
import { z } from "zod";

/**
 * Category of DM, used to group/filter rows in the audit log.
 */
export const DmKindSchema = z.enum([
  "permission_error",
  "feedback_request",
  "competition_invite",
  "prune_notice",
  // Ladder kinds. The stage-numbered kinds below are retained so historical
  // DmAuditLog rows still parse; new sends use the intent-named kinds.
  "outreach_nudge",
  "outreach_last_call",
  "outreach_3d",
  "outreach_14d",
  "outreach_30d",
  "outreach_manual",
  "data_validation",
  "dare_notification",
  // The V2 durable pipeline's DM target. A notification intent whose target is
  // an account rather than a channel delivers through here, so it gets the same
  // audit row and the same budget rules as every other DM instead of a second
  // send path of its own.
  "match_notification",
  "support_acknowledgement",
  "support_reply",
  "support_notification",
  // A Confirm button for something the recipient asked Scout to set up, sent
  // when they asked by voice and have no chat reply to put it under.
  "explore_confirmation",
]);
export type DmKind = z.infer<typeof DmKindSchema>;

/**
 * Marks a DM as non-core (onboarding/feedback rather than product output) and
 * subject to the per-server message budget.
 *
 * Enforcement lives here, in the single chokepoint every DM already flows
 * through, rather than in the callers — a future caller cannot then forget the
 * check and quietly break the "at most N messages, ever" promise we print in
 * the message body.
 */
export type DmBudget = {
  /** Server the budget is tracked against. */
  guildId: DiscordGuildId;
  /** Human-readable name, used in the transparency footer. */
  serverName: string;
  /** Install time — the boundary that scopes state to this installation. */
  installedAt: Date;
  /** Ladder rung this message represents, persisted on the audit row. */
  ladderStage?: number;
};

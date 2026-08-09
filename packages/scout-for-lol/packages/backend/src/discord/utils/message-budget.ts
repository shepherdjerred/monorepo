/**
 * The non-core message budget.
 *
 * Scout promises, in the text of every message it sends, that it will send at
 * most {@link NON_CORE_MESSAGE_BUDGET} setup/feedback messages per server, ever.
 * This module is what makes that promise true rather than aspirational.
 *
 * Two rules make it hold:
 *
 * 1. **Only delivered messages count.** A DM that bounced (recipient has DMs
 *    off, no mutual guild) does not consume budget, because the user never
 *    received anything. The old code marked a stage "sent" regardless of the
 *    outcome, which is how 33 of 37 guilds were permanently burned out of the
 *    feedback ask without ever being messaged.
 * 2. **The chokepoint enforces it, not the callers.** `sendDM` refuses to send
 *    a budgeted message once the budget is spent, so a future caller cannot
 *    accidentally bypass the guarantee by forgetting a check.
 *
 * "Core product functionality" — match reports, competition invites, permission
 * errors — is NOT budgeted. Those are the thing the user asked for.
 */

/** Lifetime cap on non-core messages per server, across every channel. */
export const NON_CORE_MESSAGE_BUDGET = 3;

/**
 * Every DM kind that can be sent as a budgeted, non-core message.
 *
 * The recipient cooldown must consider all of them, not just the
 * `outreach`-prefixed ones: the ladder sends `feedback_request` to configured
 * guilds, so matching on the prefix alone let one installer with several
 * configured servers receive multiple DMs in the same run — exactly the burst
 * the 72-hour spacing exists to prevent.
 */
export const BUDGETED_DM_KINDS = [
  "outreach_nudge",
  "outreach_last_call",
  "feedback_request",
  // Legacy kinds, still present in DmAuditLog history.
  "outreach_3d",
  "outreach_14d",
  "outreach_30d",
  "outreach_manual",
] as const;

/**
 * Minimum gap between non-core DMs to the same recipient, across all their
 * servers. Someone who installed Scout in three guilds on the same day should
 * not receive three DMs at once; the later ones are deferred, not dropped.
 */
export const RECIPIENT_COOLDOWN_MS = 72 * 60 * 60 * 1000;

/**
 * The transparency block appended to every non-core message.
 *
 * Stating the position in the budget ("message 2 of 3") is the point: a user
 * who receives one of these should be able to tell, without asking, exactly how
 * many more they can ever get. Because the count is derived from the same
 * counter that gates sending, the text cannot drift from reality.
 */
export function messageBudgetFooter(params: {
  serverName: string;
  /** 1-based position of the message being sent. */
  messageNumber: number;
}): string {
  const isFinal = params.messageNumber >= NON_CORE_MESSAGE_BUDGET;
  const budget = NON_CORE_MESSAGE_BUDGET.toString();
  const lead = `Message ${params.messageNumber.toString()} of ${budget} for **${params.serverName}**.`;
  const promise = isFinal
    ? "This is the last message Scout will ever send about this server."
    : `Scout sends at most ${budget} setup messages per server, ever — then never again.`;
  return `\n\n━━━━━━━━━━━━━━━━━━━━\n${lead} ${promise} This is automated; replies aren't monitored.`;
}

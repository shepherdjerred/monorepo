/**
 * Feedback messaging helpers.
 *
 * Used when the bot is removed from a server to invite the owner to tell us
 * why, so we can improve. The destination is configurable via `FEEDBACK_URL`.
 */

import configuration from "#src/configuration.ts";

export function getFeedbackUrl(): string {
  return (
    configuration.feedbackUrl ??
    configuration.webAppOrigin ??
    "https://scout-for-lol.com"
  );
}

/**
 * Build the DM body asking a former server owner for feedback after removal.
 */
export function buildFeedbackRequestMessage(guildName: string): string {
  return `👋 **Sorry to see Scout go from ${guildName}**

Scout was just removed from your server. We'd love to know why — your feedback genuinely helps us improve.

**What could we have done better?** Let us know here:
${getFeedbackUrl()}

If this was a mistake, you can re-invite Scout any time and set things back up with \`/subscription add\`. Thanks for giving it a try!

*This is an automated message. Replies to this DM aren't monitored.*`;
}

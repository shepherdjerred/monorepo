import type { ErrorEvent, EventHint } from "@sentry/bun";
import { z } from "zod";

const DiscordHttpErrorSchema = z.looseObject({
  name: z.enum(["DiscordAPIError", "HTTPError"]),
  status: z.number(),
});

/**
 * Sentry `beforeSend` filter for Birmel.
 *
 * Drops discord.js HTTP failures with a 5xx status: `@discordjs/rest`
 * already retried them, so each event is a known Discord-side outage rather
 * than an actionable bug. Client errors (4xx) and non-HTTP failures still
 * report.
 */
export function filterBirmelSentryEvent(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const parsed = DiscordHttpErrorSchema.safeParse(hint.originalException);
  return parsed.success && parsed.data.status >= 500 ? null : event;
}

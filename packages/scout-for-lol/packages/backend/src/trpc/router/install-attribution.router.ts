/**
 * Install Attribution Router
 *
 * The /app/installed landing page posts back the `state` token Discord echoed
 * from the bot-install round trip, plus the `guild_id` Discord appended. The
 * mutation consumes the single-use token and completes the marketing→install
 * join (see analytics/install-attribution.ts).
 *
 * Unlike telemetryRouter this necessarily carries identifiers — the token and
 * the guild id ARE the join — so it is a CSRF-protected web mutation, not a
 * public counter. Bad tokens return outcomes instead of throwing, because the
 * landing page must degrade to neutral copy, never an error screen.
 */

import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { router, webMutationProcedure } from "#src/trpc/trpc.ts";
import type { Context } from "#src/trpc/context.ts";
import {
  completeInstallAttribution,
  type CompleteInstallAttributionResult,
} from "#src/analytics/install-attribution.ts";

/**
 * Fixed-window limiter per caller (same shape as telemetryRouter's). The
 * single-use token already bounds the damage; this only bounds DB point-read
 * spam from a misbehaving client.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const PER_CALLER_MAX_CALLS = 10;
const MAX_TRACKED_CALLERS = 5000;

let windowStartedAt = Date.now();
const callsByCaller = new Map<string, number>();

function withinRateLimit(callerKey: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now;
    callsByCaller.clear();
  }
  const forCaller = (callsByCaller.get(callerKey) ?? 0) + 1;
  if (forCaller > PER_CALLER_MAX_CALLS) return false;
  if (forCaller > 1 || callsByCaller.size < MAX_TRACKED_CALLERS) {
    callsByCaller.set(callerKey, forCaller);
  }
  return true;
}

function callerKeyFor(ctx: Context): string {
  const sessionId = ctx.webSession?.discordId;
  if (sessionId !== undefined) return `u:${sessionId}`;
  return `ip:${ctx.clientIp ?? "unknown"}`;
}

/** Exposed for tests so the limiter can't leak state between cases. */
export function resetInstallAttributionRateLimitForTests(): void {
  windowStartedAt = Date.now();
  callsByCaller.clear();
}

const CompleteInstallInputSchema = z.object({
  /** The token minted by /api/discord/install, echoed via OAuth `state`. */
  state: z.string().min(32).max(128),
  /** Absent when the user cancelled on Discord's authorize screen. */
  guildId: DiscordGuildIdSchema.optional(),
});

export const installAttributionRouter = router({
  complete: webMutationProcedure
    .input(CompleteInstallInputSchema)
    .mutation(
      async ({ ctx, input }): Promise<CompleteInstallAttributionResult> => {
        if (!withinRateLimit(callerKeyFor(ctx))) {
          return { outcome: "invalid" };
        }
        // The session's discordId is a verified JWT `sub`; a malformed value
        // means a broken session, and attribution degrades rather than throws.
        const discordId = DiscordAccountIdSchema.safeParse(
          ctx.webSession.discordId,
        );
        if (!discordId.success) {
          return { outcome: "invalid" };
        }
        return completeInstallAttribution({
          state: input.state,
          guildId: input.guildId,
          discordId: discordId.data,
        });
      },
    ),
});

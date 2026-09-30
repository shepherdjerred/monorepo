/**
 * Translation of Discord REST failures into tRPC errors.
 *
 * Kept in the tRPC layer so `lib/discord-rest.ts` stays transport-agnostic and
 * only raises domain errors.
 *
 * The rule this module exists to enforce: a failure to reach Discord is NEVER
 * `FORBIDDEN`. Reporting an outage as "You are not a member of that guild"
 * tells the user they lack permission, so they never think to retry or
 * re-authenticate — which is exactly the confusion this replaces.
 */

import { TRPCError } from "@trpc/server";
import type { User } from "#generated/prisma/client/index.js";
import {
  DiscordUpstreamError,
  fetchUserGuilds,
  type PartialGuild,
} from "#src/lib/discord-rest.ts";
import {
  discordBotRestFailures,
  discordUserGuildsFailures,
} from "#src/metrics/platform/web.ts";

/**
 * Map a {@link DiscordUpstreamError} onto the tRPC error the user should see.
 *
 * - `token_refresh_failed` → `UNAUTHORIZED`: their Discord grant is gone, so
 *   signing in again genuinely fixes it.
 * - everything else → `SERVICE_UNAVAILABLE`: our problem, and retryable.
 */
export function toTrpcError(error: DiscordUpstreamError): TRPCError {
  if (error.reason === "token_refresh_failed") {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "Your Discord login expired — sign in again.",
      cause: error,
    });
  }
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "Couldn't reach Discord, try again in a moment.",
    cause: error,
  });
}

/**
 * `fetchUserGuilds` for request-handling code paths: records the failure reason
 * for alerting and rethrows as a correctly-coded `TRPCError`.
 *
 * Use this everywhere a tRPC procedure needs the caller's guilds; call
 * `fetchUserGuilds` directly only from non-request contexts.
 */
export async function fetchUserGuildsForRequest(
  user: User,
): Promise<PartialGuild[]> {
  try {
    return await fetchUserGuilds(user);
  } catch (error) {
    if (error instanceof DiscordUpstreamError) {
      discordUserGuildsFailures.inc({ reason: error.reason });
      throw toTrpcError(error);
    }
    throw error;
  }
}

/**
 * Run a bot-token Discord read (`lib/discord/bot-rest.ts`) on a request path.
 *
 * Those reads replaced the gateway guild cache, so they now decide whether a
 * guild-scoped procedure answers at all. Wrapping them here keeps the same rule
 * the OAuth path already follows: a failure to reach Discord surfaces as
 * SERVICE_UNAVAILABLE, never as NOT_FOUND ("Scout is not installed") or
 * FORBIDDEN. Without this an unwrapped `DiscordUpstreamError` would reach tRPC
 * as an opaque INTERNAL_SERVER_ERROR, which tells the user nothing about
 * retrying.
 */
export async function callDiscordForRequest<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DiscordUpstreamError) {
      discordBotRestFailures.inc({ reason: error.reason });
      throw toTrpcError(error);
    }
    throw error;
  }
}

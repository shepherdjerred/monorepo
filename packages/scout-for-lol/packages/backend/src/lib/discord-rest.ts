/**
 * Helpers for calling Discord's REST API as a specific user (using a
 * stored OAuth access token) — distinct from the bot's gateway client.
 * Used by the web UI to figure out which guilds the signed-in user is
 * an Administrator of.
 */

import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import type { User } from "#generated/prisma/client/index.js";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-rest");
const DISCORD_API_BASE = "https://discord.com/api/v10";
/** Bound every outbound Discord REST call so a stalled upstream can't
 * hold an inbound tRPC request open. Discord's own SLA is well under
 * this; 5s is generous. */
const DISCORD_FETCH_TIMEOUT_MS = 5000;

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

const PartialGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  owner: z.boolean(),
  permissions: z.string(),
});
export type PartialGuild = z.infer<typeof PartialGuildSchema>;
const PartialGuildsArraySchema = z.array(PartialGuildSchema);

/**
 * Discord's ADMINISTRATOR permission bit.
 * https://discord.com/developers/docs/topics/permissions
 */
export const ADMINISTRATOR_BIT = 0x8n;

export function hasAdministrator(permissionsString: string): boolean {
  try {
    const perms = BigInt(permissionsString);
    return (perms & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
  } catch {
    return false;
  }
}

/**
 * Why a call to Discord's REST API could not be completed.
 *
 * `token_refresh_failed` is the only reason that means "this user must sign in
 * again" — every other reason is a transient upstream problem and says nothing
 * about the user's credentials. Callers MUST preserve that distinction: an
 * upstream failure is not evidence of missing permissions.
 */
export type DiscordUpstreamReason =
  | "token_refresh_failed"
  | "fetch_error"
  | "http_error"
  | "parse_error"
  | "schema_error";

/**
 * Raised when we could not obtain an authoritative answer from Discord.
 *
 * This exists because the previous behaviour — returning `[]` from
 * {@link fetchUserGuilds} on any failure — was indistinguishable from "this
 * user is genuinely in no guilds", so a Discord outage surfaced to the user as
 * "You are not a member of that guild". Never convert an instance of this into
 * an empty result; propagate it.
 */
export class DiscordUpstreamError extends Error {
  readonly reason: DiscordUpstreamReason;
  readonly status: number | undefined;

  constructor(reason: DiscordUpstreamReason, message: string, status?: number) {
    super(message);
    this.name = "DiscordUpstreamError";
    this.reason = reason;
    this.status = status;
  }
}

/**
 * Wrap fetch with a hard timeout. Throws {@link DiscordUpstreamError} on
 * network failure or timeout so the caller cannot silently mistake an
 * unreachable upstream for a valid empty answer.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  description: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, DISCORD_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    logger.warn(`Discord fetch failed: ${description}`, { url, error });
    throw new DiscordUpstreamError(
      "fetch_error",
      `Discord request failed: ${description}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function refreshUserToken(user: User): Promise<string> {
  if (
    user.discordRefreshToken === null ||
    configuration.discordClientSecret === undefined
  ) {
    throw new DiscordUpstreamError(
      "token_refresh_failed",
      "No Discord refresh token available for this user",
    );
  }

  const response = await fetchWithTimeout(
    `${DISCORD_API_BASE}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: configuration.applicationId,
        client_secret: configuration.discordClientSecret,
        grant_type: "refresh_token",
        refresh_token: user.discordRefreshToken,
      }),
    },
    "oauth2/token refresh",
  );

  if (!response.ok) {
    logger.warn("Discord refresh-token failed", { status: response.status });
    // 400 (`invalid_grant`) / 401 mean the grant is genuinely gone — the user
    // revoked access or the refresh token expired, so they must sign in again.
    // Any other status is an upstream fault and must not be reported as an
    // authentication problem.
    const revoked = response.status === 400 || response.status === 401;
    throw new DiscordUpstreamError(
      revoked ? "token_refresh_failed" : "http_error",
      `Discord token refresh returned ${response.status.toString()}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.warn("Discord refresh-token JSON parse failed", { error });
    throw new DiscordUpstreamError(
      "parse_error",
      "Discord token refresh returned malformed JSON",
    );
  }

  const parsed = RefreshResponseSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Discord refresh-token schema mismatch", {
      issues: parsed.error.issues.slice(0, 3),
    });
    throw new DiscordUpstreamError(
      "schema_error",
      "Discord token refresh returned an unexpected shape",
    );
  }

  const refreshed = parsed.data;
  await prisma.user.update({
    where: { discordId: user.discordId },
    data: {
      discordAccessToken: refreshed.access_token,
      discordRefreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}

/**
 * The user's current Discord access token, refreshing it if it is expired or
 * about to be. Throws {@link DiscordUpstreamError} rather than returning null
 * so a refresh failure cannot be mistaken for "no access".
 */
export async function getFreshUserAccessToken(user: User): Promise<string> {
  const expiresAt = user.tokenExpiresAt;
  // Refresh if expired or within 60s of expiry.
  if (
    expiresAt !== null &&
    user.discordAccessToken !== null &&
    expiresAt.getTime() > Date.now() + 60_000
  ) {
    return user.discordAccessToken;
  }
  return refreshUserToken(user);
}

type CachedGuilds = {
  guilds: PartialGuild[];
  fetchedAt: number;
};
const guildsCache = new Map<string, CachedGuilds>();
const GUILDS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * The guilds the signed-in user belongs to, as reported by Discord.
 *
 * An empty array means Discord authoritatively said "no guilds". Every failure
 * to reach that answer throws {@link DiscordUpstreamError} instead — callers
 * must not treat an unreachable upstream as an empty membership list, because
 * that is what previously surfaced a Discord outage to the user as the flatly
 * wrong "You are not a member of that guild".
 */
export async function fetchUserGuilds(user: User): Promise<PartialGuild[]> {
  const cached = guildsCache.get(user.discordId);
  if (cached !== undefined) {
    if (Date.now() - cached.fetchedAt < GUILDS_CACHE_TTL_MS) {
      return cached.guilds;
    }
    // Stale — drop so the Map stays bounded across long-running pods.
    guildsCache.delete(user.discordId);
  }

  const token = await getFreshUserAccessToken(user);

  const response = await fetchWithTimeout(
    `${DISCORD_API_BASE}/users/@me/guilds`,
    { headers: { Authorization: `Bearer ${token}` } },
    "users/@me/guilds",
  );

  if (!response.ok) {
    logger.warn("Discord /users/@me/guilds failed", {
      status: response.status,
    });
    // A 401 here means the access token we just presented was rejected, which
    // is an authentication problem; anything else is an upstream fault.
    throw new DiscordUpstreamError(
      response.status === 401 ? "token_refresh_failed" : "http_error",
      `Discord /users/@me/guilds returned ${response.status.toString()}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.warn("Discord guilds JSON parse failed", { error });
    throw new DiscordUpstreamError(
      "parse_error",
      "Discord /users/@me/guilds returned malformed JSON",
    );
  }

  const parsed = PartialGuildsArraySchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Discord guilds schema mismatch", {
      issues: parsed.error.issues.slice(0, 3),
    });
    throw new DiscordUpstreamError(
      "schema_error",
      "Discord /users/@me/guilds returned an unexpected shape",
    );
  }

  guildsCache.set(user.discordId, {
    guilds: parsed.data,
    fetchedAt: Date.now(),
  });
  return parsed.data;
}

/**
 * Invalidate the per-user guild cache. Call when a user re-authenticates
 * or their permissions are known to have changed.
 */
export function invalidateUserGuildsCache(discordId: string): void {
  guildsCache.delete(discordId);
}

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
 * Wrap fetch with a hard timeout. Returns null on fetch failure /
 * timeout so callers can degrade to an auth-failure path rather than
 * leaking the error to the tRPC response.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  description: string,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, DISCORD_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    logger.warn(`Discord fetch failed: ${description}`, { url, error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshUserToken(user: User): Promise<string | null> {
  if (
    user.discordRefreshToken === null ||
    configuration.discordClientSecret === undefined
  ) {
    return null;
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

  if (response === null) {
    logger.warn("Discord refresh-token failed", { status: "fetch-error" });
    return null;
  }
  if (!response.ok) {
    logger.warn("Discord refresh-token failed", { status: response.status });
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.warn("Discord refresh-token JSON parse failed", { error });
    return null;
  }

  const parsed = RefreshResponseSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Discord refresh-token schema mismatch", {
      issues: parsed.error.issues.slice(0, 3),
    });
    return null;
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

export async function getFreshUserAccessToken(
  user: User,
): Promise<string | null> {
  const expiresAt = user.tokenExpiresAt;
  // Refresh if expired or within 60s of expiry.
  if (
    user.discordAccessToken !== null &&
    expiresAt !== null &&
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
  if (token === null) return [];

  const response = await fetchWithTimeout(
    `${DISCORD_API_BASE}/users/@me/guilds`,
    { headers: { Authorization: `Bearer ${token}` } },
    "users/@me/guilds",
  );

  if (response === null) {
    logger.warn("Discord /users/@me/guilds failed", { status: "fetch-error" });
    return [];
  }
  if (!response.ok) {
    logger.warn("Discord /users/@me/guilds failed", {
      status: response.status,
    });
    return [];
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    logger.warn("Discord guilds JSON parse failed", { error });
    return [];
  }

  const parsed = PartialGuildsArraySchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Discord guilds schema mismatch", {
      issues: parsed.error.issues.slice(0, 3),
    });
    return [];
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

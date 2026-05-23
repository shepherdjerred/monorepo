/**
 * HTTP endpoints for the web sign-in flow.
 *
 * These are intentionally NOT tRPC procedures because they need to set
 * HTTP-only cookies and issue redirects, which are awkward through the
 * tRPC fetch adapter. The tRPC `auth.getWebOAuthUrl` query produces the
 * Discord URL; Discord redirects the browser to handleDiscordCallback;
 * the SPA then uses tRPC for everything else with cookies attached.
 */

import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "#src/trpc/context.ts";
import { signSession } from "#src/trpc/jwt.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import configuration from "#src/configuration.ts";

const logger = createLogger("auth-web");
const DISCORD_API_BASE = "https://discord.com/api/v10";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const DiscordTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
});

const DiscordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  discriminator: z.string(),
  avatar: z.string().nullable(),
  email: z.string().optional(),
});

function buildCookie(params: {
  name: string;
  value: string;
  maxAgeSeconds: number;
  httpOnly: boolean;
  secure: boolean;
}): string {
  const parts = [
    `${params.name}=${encodeURIComponent(params.value)}`,
    "Path=/",
    `Max-Age=${params.maxAgeSeconds.toString()}`,
    "SameSite=Strict",
  ];
  if (params.httpOnly) parts.push("HttpOnly");
  if (params.secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function decodeReturnTo(state: string | null): string {
  if (state === null) return "/app/";
  const pipe = state.indexOf("|");
  if (pipe === -1) return "/app/";
  try {
    const raw = decodeURIComponent(state.slice(pipe + 1));
    if (raw.startsWith("/app/")) return raw;
    return "/app/";
  } catch {
    return "/app/";
  }
}

/**
 * Handle the Discord OAuth callback. Discord redirects the browser here
 * after the user authorizes Scout. We exchange the code for tokens,
 * upsert the User row, mint a JWT, set HttpOnly+CSRF cookies, and
 * redirect the browser to /app/ (or returnTo from state).
 */
export async function handleDiscordCallback(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const appOrigin = configuration.webAppOrigin ?? url.origin;
  const callbackOrigin = `${url.protocol}//${url.host}`;
  const callbackUrl = `${callbackOrigin}/api/auth/discord/callback`;

  if (error !== null) {
    logger.info(`OAuth denied or failed: ${error}`);
    return Response.redirect(
      `${appOrigin}/app/login?error=${encodeURIComponent(error)}`,
      302,
    );
  }

  if (code === null || code.length === 0) {
    return new Response("Missing OAuth code", { status: 400 });
  }

  if (configuration.discordClientSecret === undefined) {
    logger.error("DISCORD_CLIENT_SECRET not configured");
    return new Response("Server misconfigured: OAuth disabled", {
      status: 500,
    });
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.applicationId,
      client_secret: configuration.discordClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    logger.error("Discord token exchange failed", {
      status: tokenResponse.status,
      text,
    });
    return new Response("Discord rejected the authorization code", {
      status: 400,
    });
  }

  const tokenJson: unknown = await tokenResponse.json();
  const tokens = DiscordTokenResponseSchema.parse(tokenJson);

  // Fetch user
  const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResponse.ok) {
    logger.error("Failed to fetch Discord user");
    return new Response("Failed to fetch user info", { status: 502 });
  }
  const userJson: unknown = await userResponse.json();
  const discordUser = DiscordUserSchema.parse(userJson);

  const discordId = DiscordAccountIdSchema.parse(discordUser.id);
  await prisma.user.upsert({
    where: { discordId },
    update: {
      discordUsername: discordUser.username,
      discordAvatar: discordUser.avatar,
      discordAccessToken: tokens.access_token,
      discordRefreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
    create: {
      discordId,
      discordUsername: discordUser.username,
      discordAvatar: discordUser.avatar,
      discordAccessToken: tokens.access_token,
      discordRefreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  const { jwt } = await signSession({ discordId });
  const csrfBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(csrfBytes);
  const csrfToken = [...csrfBytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const isHttps = url.protocol === "https:";
  const returnTo = decodeReturnTo(state);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: SESSION_COOKIE,
      value: jwt,
      maxAgeSeconds: SESSION_TTL_SECONDS,
      httpOnly: true,
      secure: isHttps,
    }),
  );
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: CSRF_COOKIE,
      value: csrfToken,
      maxAgeSeconds: SESSION_TTL_SECONDS,
      httpOnly: false,
      secure: isHttps,
    }),
  );
  headers.set("Location", `${appOrigin}${returnTo}`);

  logger.info(
    `Web sign-in succeeded for ${discordUser.username} (${discordId})`,
  );
  return new Response(null, { status: 302, headers });
}

/**
 * Clear the web session cookies and return 204.
 * SPA hits this on logout; subsequent tRPC calls will lack a session.
 */
export function handleWebLogout(request: Request): Response {
  const url = new URL(request.url);
  const isHttps = url.protocol === "https:";

  const headers = new Headers();
  headers.append("Set-Cookie", buildClearCookie(SESSION_COOKIE, isHttps));
  headers.append("Set-Cookie", buildClearCookie(CSRF_COOKIE, isHttps));
  return new Response(null, { status: 204, headers });
}

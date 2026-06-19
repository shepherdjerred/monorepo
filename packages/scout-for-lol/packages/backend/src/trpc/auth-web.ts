/**
 * HTTP endpoints for the web sign-in flow.
 *
 * Two routes wrap the Discord OAuth handshake:
 *
 *   GET /api/auth/discord/start    — generates the state nonce, sets a
 *                                    short-lived HttpOnly pre-auth cookie,
 *                                    and 302s the browser to Discord.
 *   GET /api/auth/discord/callback — verifies the state nonce against the
 *                                    cookie, exchanges the code for tokens,
 *                                    mints the session JWT, sets cookies,
 *                                    302s back to /app/.
 *
 * They are intentionally NOT tRPC procedures because they need to set
 * HttpOnly cookies and issue redirects, which are awkward through the
 * tRPC fetch adapter. The SPA navigates to /api/auth/discord/start
 * directly (no fetch); the rest of the app uses tRPC.
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
/** Pre-auth state cookie TTL — long enough for the Discord round-trip, short enough to limit replay. */
const OAUTH_STATE_TTL_SECONDS = 5 * 60;
const OAUTH_STATE_COOKIE = "scout_oauth_state";

/**
 * Permissions Scout's bot needs in a guild, mirroring the "Required
 * Permissions" section of the docs site. The `applications.commands`
 * scope (requested in the install URL) covers slash-command
 * registration, so it is NOT a permission bit here.
 *
 *   View Channel    1 << 10
 *   Send Messages   1 << 11
 *   Embed Links     1 << 14   (rich match-report embeds)
 *   Attach Files    1 << 15   (post-match report images)
 */
const BOT_INSTALL_PERMISSIONS = (
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n)
).toString();

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
});

function buildCookie(params: {
  name: string;
  value: string;
  maxAgeSeconds: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax";
}): string {
  const parts = [
    `${params.name}=${encodeURIComponent(params.value)}`,
    "Path=/",
    `Max-Age=${params.maxAgeSeconds.toString()}`,
    `SameSite=${params.sameSite}`,
  ];
  if (params.httpOnly) parts.push("HttpOnly");
  if (params.secure) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie(
  name: string,
  secure: boolean,
  sameSite: "Strict" | "Lax",
): string {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", `SameSite=${sameSite}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookies(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (header === null) return map;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    map.set(name, decodeURIComponent(value));
  }
  return map;
}

/**
 * `webAppOrigin` is the public-facing scheme+host the browser uses for
 * the SPA (e.g. https://scout-for-lol.com). The backend sits behind
 * Caddy which terminates TLS, so request.url's protocol is `http:` and
 * MUST NOT be used to derive Discord redirect URIs.
 */
function getAppOrigin(): string {
  const origin = configuration.webAppOrigin;
  if (origin === undefined || origin.length === 0) {
    throw new Error("WEB_APP_ORIGIN is not configured");
  }
  return origin;
}

function getCallbackUrl(): string {
  return `${getAppOrigin()}/api/auth/discord/callback`;
}

function checkStateNonce(
  state: string,
  expectedNonce: string | undefined,
): boolean {
  if (expectedNonce === undefined || expectedNonce.length === 0) return false;
  return state.startsWith(`${expectedNonce}|`);
}

function safeReturnTo(value: string | null): string {
  if (value === null) return "/app/";
  // Only allow same-app paths. Prevents open-redirect via returnTo.
  if (value.startsWith("/app/")) return value;
  return "/app/";
}

/**
 * GET /api/auth/discord/start[?returnTo=/app/...]
 *
 * Generates a random state nonce, stashes it in an HttpOnly pre-auth
 * cookie, then 302s the browser to Discord's authorize endpoint with
 * the same nonce in the state parameter. The callback compares the two.
 */
export function handleDiscordStart(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  const nonceBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(nonceBytes);
  const nonce = [...nonceBytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const state = `${nonce}|${encodeURIComponent(returnTo)}`;

  const params = new URLSearchParams({
    client_id: configuration.applicationId,
    redirect_uri: getCallbackUrl(),
    response_type: "code",
    scope: ["identify", "guilds"].join(" "),
    prompt: "consent",
    state,
  });

  const isHttps = getAppOrigin().startsWith("https://");
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: OAUTH_STATE_COOKIE,
      value: nonce,
      maxAgeSeconds: OAUTH_STATE_TTL_SECONDS,
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
    }),
  );
  headers.set(
    "Location",
    `https://discord.com/api/oauth2/authorize?${params.toString()}`,
  );

  return new Response(null, { status: 302, headers });
}

/**
 * GET /api/discord/install
 *
 * 302s the browser to Discord's bot-authorization screen so a
 * signed-in admin can add Scout to one of their servers. We build the
 * URL server-side to keep the application ID and the required
 * permission bits out of the SPA bundle.
 *
 * `redirect_uri` points at the SPA's /app/installed landing route;
 * Discord appends `guild_id` (and `permissions`) on success, letting
 * the app deep-link straight into that guild's config. The redirect URI
 * must be registered in the Discord Developer Portal for this app or
 * Discord rejects the request with `invalid redirect_uri`.
 *
 * Unlike the login flow there is no `response_type=code` and no state
 * cookie: this is a pure bot install, not a user-token grant, and the
 * caller is already authenticated via their session cookie.
 */
export function handleDiscordInstall(_request: Request): Response {
  const params = new URLSearchParams({
    client_id: configuration.applicationId,
    scope: ["bot", "applications.commands"].join(" "),
    permissions: BOT_INSTALL_PERMISSIONS,
    redirect_uri: `${getAppOrigin()}/app/installed`,
  });

  const headers = new Headers();
  headers.set(
    "Location",
    `https://discord.com/api/oauth2/authorize?${params.toString()}`,
  );

  return new Response(null, { status: 302, headers });
}

/**
 * Handle the Discord OAuth callback. Discord redirects the browser here
 * after the user authorizes Scout. We:
 *   1. Verify state matches the pre-auth cookie (CSRF defense)
 *   2. Exchange the code for tokens
 *   3. Upsert the User row
 *   4. Mint a JWT session
 *   5. Set HttpOnly session + JS-readable CSRF cookies
 *   6. Clear the pre-auth state cookie
 *   7. 302 to /app/ (or returnTo from state)
 */
export async function handleDiscordCallback(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const appOrigin = getAppOrigin();
  const callbackUrl = getCallbackUrl();
  const isHttps = appOrigin.startsWith("https://");

  const cookies = parseCookies(request.headers.get("Cookie"));
  const expectedNonce = cookies.get(OAUTH_STATE_COOKIE);

  // Always clear the pre-auth cookie on any callback path.
  const clearStateCookie = buildClearCookie(OAUTH_STATE_COOKIE, isHttps, "Lax");

  if (oauthError !== null) {
    logger.info(`OAuth denied or failed: ${oauthError}`);
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    headers.set(
      "Location",
      `${appOrigin}/app/login?error=${encodeURIComponent(oauthError)}`,
    );
    return new Response(null, { status: 302, headers });
  }

  if (code === null || code.length === 0) {
    return new Response("Missing OAuth code", { status: 400 });
  }

  // CSRF / session-fixation defense: state from the redirect must
  // carry the same nonce we stashed in the pre-auth cookie. We split
  // the null check out so TS can narrow `state` to string in the rest
  // of this function.
  if (state === null || !checkStateNonce(state, expectedNonce)) {
    logger.warn("OAuth state mismatch — possible CSRF or expired flow", {
      hasCookie: expectedNonce !== undefined,
      hasState: state !== null,
    });
    const headers = new Headers();
    headers.append("Set-Cookie", clearStateCookie);
    headers.set("Location", `${appOrigin}/app/login?error=state_mismatch`);
    return new Response(null, { status: 302, headers });
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

  // Extract returnTo from state — already verified to start with `${nonce}|`.
  const pipe = state.indexOf("|");
  const rawReturn = pipe === -1 ? "" : state.slice(pipe + 1);
  let returnTo: string;
  try {
    returnTo = safeReturnTo(decodeURIComponent(rawReturn));
  } catch {
    returnTo = "/app/";
  }

  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie);
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: SESSION_COOKIE,
      value: jwt,
      maxAgeSeconds: SESSION_TTL_SECONDS,
      httpOnly: true,
      secure: isHttps,
      sameSite: "Strict",
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
      sameSite: "Strict",
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
export function handleWebLogout(_request: Request): Response {
  // request.url's protocol is `http:` behind Caddy (it terminates TLS),
  // so we must derive Secure from the configured public origin — same
  // pattern as the OAuth callback. With Secure mismatched against the
  // original Set-Cookie, modern browsers can refuse to clear the cookies.
  const isHttps = getAppOrigin().startsWith("https://");

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    buildClearCookie(SESSION_COOKIE, isHttps, "Strict"),
  );
  headers.append(
    "Set-Cookie",
    buildClearCookie(CSRF_COOKIE, isHttps, "Strict"),
  );
  return new Response(null, { status: 204, headers });
}

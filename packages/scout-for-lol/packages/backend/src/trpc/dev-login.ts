/**
 * GET /api/dev/login[?discordId=...&username=...&returnTo=/app/...]
 *
 * Dev-only instant sign-in: mints a real session for a chosen (or fake
 * default) Discord user without the Discord OAuth round-trip, so local UI
 * work can be screenshotted/verified without a browser click-through.
 *
 * Only ever registered by http-server.ts when `configuration.environment
 * === "dev"` — the assertion below is belt-and-suspenders in case this
 * function is ever called from anywhere else.
 */

import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  buildCookie,
  generateCsrfToken,
  getAppOrigin,
  safeReturnTo,
} from "#src/trpc/auth-web.ts";
import { CSRF_COOKIE, SESSION_COOKIE } from "#src/trpc/context.ts";
import { signSession } from "#src/trpc/jwt.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import configuration from "#src/configuration.ts";

const logger = createLogger("dev-login");

/** Stable placeholder Discord ID used when `?discordId=` is omitted. */
export const DEV_LOGIN_DEFAULT_DISCORD_ID = "000000000000000001";
const DEV_LOGIN_DEFAULT_USERNAME = "Dev Test User";

/** Short-lived on purpose: this is a re-mintable throwaway, not a real login. */
const DEV_LOGIN_TTL_SECONDS = 24 * 60 * 60;

export async function handleDevLogin(
  request: Request,
  prisma: Pick<ExtendedPrismaClient, "user">,
): Promise<Response> {
  if (configuration.environment !== "dev") {
    throw new Error(
      "handleDevLogin invoked outside environment=dev — this must never happen",
    );
  }

  const url = new URL(request.url);
  const rawDiscordId = url.searchParams.get("discordId");
  const discordIdResult = DiscordAccountIdSchema.safeParse(
    rawDiscordId ?? DEV_LOGIN_DEFAULT_DISCORD_ID,
  );
  if (!discordIdResult.success) {
    return new Response(
      `Invalid discordId query param: ${z.prettifyError(discordIdResult.error)}`,
      { status: 400, headers: { "Content-Type": "text/plain" } },
    );
  }
  const discordId = discordIdResult.data;
  const username =
    url.searchParams.get("username") ?? DEV_LOGIN_DEFAULT_USERNAME;

  await prisma.user.upsert({
    where: { discordId },
    update: { discordUsername: username },
    create: { discordId, discordUsername: username, discordAvatar: null },
  });

  const { jwt } = await signSession({
    discordId,
    ttlSeconds: DEV_LOGIN_TTL_SECONDS,
  });
  const csrfToken = generateCsrfToken();

  const appOrigin = getAppOrigin();
  const isHttps = appOrigin.startsWith("https://");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: SESSION_COOKIE,
      value: jwt,
      maxAgeSeconds: DEV_LOGIN_TTL_SECONDS,
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
      maxAgeSeconds: DEV_LOGIN_TTL_SECONDS,
      httpOnly: false,
      secure: isHttps,
      sameSite: "Strict",
    }),
  );
  headers.set("Location", `${appOrigin}${returnTo}`);

  logger.info(`Dev login minted for discordId=${discordId} (${username})`);
  return new Response(null, { status: 302, headers });
}

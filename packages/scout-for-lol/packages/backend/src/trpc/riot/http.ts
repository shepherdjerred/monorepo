import { TRPCError } from "@trpc/server";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import {
  createRiotLinkAttempt,
  riotLinkDigest,
} from "#src/database/riot-accounts.ts";
import { createLogger } from "#src/logger.ts";
import { buildCookie, getAppOrigin } from "#src/trpc/auth-web-helpers.ts";
import { createContext } from "#src/trpc/context.ts";
import { requireWebMutationSession } from "#src/trpc/trpc.ts";
import {
  decryptRiotLinkFlow,
  encryptRiotLinkFlow,
  newRiotLinkFlow,
  RIOT_LINK_COOKIE,
  RIOT_LINK_TTL_SECONDS,
} from "./link-cookie.ts";
import {
  riotAuthorizeUrl,
  RiotSignOnError,
  verifyRiotAuthorization,
  type RiotIdentity,
  type RiotRsoCredentials,
} from "./provider.ts";

const logger = createLogger("riot-account-link");
const StartResponseSchema = z.object({ authorizeUrl: z.url() });
export { StartResponseSchema as RiotLinkStartResponseSchema };

export function riotRsoCredentials(): RiotRsoCredentials {
  const { riotRsoClientId: clientId, riotRsoClientSecret: clientSecret } =
    configuration;
  if (clientId === undefined || clientSecret === undefined) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Riot account linking is not configured yet.",
    });
  }
  return { clientId, clientSecret };
}

function signingSecret(): string {
  const secret = configuration.jwtSigningSecret;
  if (secret === undefined)
    throw new Error("Riot account linking requires JWT_SIGNING_SECRET");
  return secret;
}

function landing(result: string, clearCookie = false): Response {
  const headers = new Headers({
    Location: `${getAppOrigin()}/app/settings?riot=${encodeURIComponent(result)}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  if (clearCookie)
    headers.append(
      "Set-Cookie",
      buildCookie({
        name: RIOT_LINK_COOKIE,
        value: "",
        maxAgeSeconds: 0,
        httpOnly: true,
        sameSite: "Lax",
        secure: getAppOrigin().startsWith("https:"),
      }),
    );
  return new Response(null, { status: 303, headers });
}

async function start(request: Request): Promise<Response> {
  const ctx = requireWebMutationSession(await createContext(request));
  if (
    !(await isPolicyEnabled("riot_account_linking_enabled", {
      user: ctx.webSession.discordId,
      stage: configuration.environment,
    }))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "New Riot account links are not available yet.",
    });
  }
  const credentials = riotRsoCredentials();
  const sessionId = ctx.webSession.sessionId;
  if (sessionId === undefined)
    throw new Error("Authenticated web session has no session identity");
  const flow = newRiotLinkFlow();
  const outcome = await createRiotLinkAttempt(
    {
      state: flow.state,
      discordId: ctx.user.discordId,
      sessionId,
    },
    prisma,
  );
  if (outcome === "rate-limited")
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many linking attempts. Please retry in a few minutes.",
    });
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  headers.append(
    "Set-Cookie",
    buildCookie({
      name: RIOT_LINK_COOKIE,
      value: await encryptRiotLinkFlow(flow, signingSecret()),
      maxAgeSeconds: RIOT_LINK_TTL_SECONDS,
      httpOnly: true,
      sameSite: "Lax",
      secure: getAppOrigin().startsWith("https:"),
    }),
  );
  return Response.json(
    StartResponseSchema.parse({
      authorizeUrl: riotAuthorizeUrl(
        credentials,
        `${getAppOrigin()}/api/auth/riot/callback`,
        flow,
      ),
    }),
    { headers },
  );
}

function cookieFrom(request: Request): string | undefined {
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${RIOT_LINK_COOKIE}=`));
  if (entry === undefined) return undefined;
  try {
    return decodeURIComponent(entry.slice(RIOT_LINK_COOKIE.length + 1));
  } catch {
    return undefined;
  }
}

async function callback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const flow = await decryptRiotLinkFlow(cookieFrom(request), signingSecret());
  if (flow === null) return landing("expired", true);
  if (url.searchParams.get("state") !== flow.state)
    return landing("expired", true);
  if (url.searchParams.has("error")) return landing("cancelled", true);
  const code = url.searchParams.get("code") ?? "";
  if (code.length === 0) return landing("failed", true);
  const stateDigest = riotLinkDigest(flow.state);
  const claim = await prisma.riotOAuthLinkAttempt.updateMany({
    where: {
      stateDigest,
      expiresAt: { gt: new Date() },
      claimedAt: null,
      consumedAt: null,
    },
    data: { claimedAt: new Date() },
  });
  if (claim.count !== 1) return landing("expired", true);
  const credentials = riotRsoCredentials();
  let identity: RiotIdentity;
  try {
    identity = await verifyRiotAuthorization({
      credentials,
      flow,
      code,
      callbackUrl: `${getAppOrigin()}/api/auth/riot/callback`,
      riotApiKey: configuration.riotApiToken,
    });
  } catch (error) {
    // OAuth responses and validation failures can contain credentials. Never log them.
    const reason =
      error instanceof RiotSignOnError ? error.reason : "provider-unavailable";
    logger.warn("Riot account verification did not complete", { reason });
    return landing(
      reason === "project-mismatch" ? "project-mismatch" : "failed",
      true,
    );
  }
  await prisma.riotOAuthLinkAttempt.update({
    where: { stateDigest },
    data: {
      verifiedPuuid: identity.puuid,
      gameName: identity.gameName,
      tagLine: identity.tagLine,
      verifiedAt: new Date(),
    },
  });
  // The callback has a Lax flow cookie. The SPA's subsequent mutation restores
  // the Strict Scout session and proves the initiating user is still signed in.
  return landing("complete");
}

function trpcStatus(error: TRPCError): number {
  const statuses: Partial<Record<TRPCError["code"], number>> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    TOO_MANY_REQUESTS: 429,
    SERVICE_UNAVAILABLE: 503,
  };
  return statuses[error.code] ?? 500;
}

export async function handleRiotAuthRoutes(
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (
    url.pathname !== "/api/auth/riot/start" &&
    url.pathname !== "/api/auth/riot/callback"
  )
    return null;
  const expectedMethod = url.pathname.endsWith("/start") ? "POST" : "GET";
  if (request.method !== expectedMethod)
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: expectedMethod },
    });
  try {
    return expectedMethod === "POST"
      ? await start(request)
      : await callback(request);
  } catch (error) {
    if (error instanceof TRPCError) {
      return Response.json(
        { message: error.message },
        { status: trpcStatus(error), headers: { "Cache-Control": "no-store" } },
      );
    }
    logger.error("Unexpected Riot account linking failure");
    return Response.json(
      { message: "Riot account linking could not complete. Please retry." },
      { status: 500 },
    );
  }
}

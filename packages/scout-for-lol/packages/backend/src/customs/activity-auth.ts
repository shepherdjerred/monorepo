import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import {
  CustomActivityClaimsSchema,
  CustomAuthExchangeInputSchema,
  CustomAuthRefreshInputSchema,
  CustomAuthResponseSchema,
  type CustomActivityClaims,
  type CustomAuthResponse,
} from "@scout-for-lol/data";
import configuration, {
  type CustomsConfiguration,
} from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const ACTIVITY_TOKEN_TTL_SECONDS = 10 * 60;
const ACTIVITY_REFRESH_GRACE_SECONDS = 12 * 60 * 60;
const logger = createLogger("customs-activity-auth");

class CustomAuthHttpError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.status = status;
  }
}

const RawDiscordTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string(),
});
type RawDiscordTokenResponse = z.infer<typeof RawDiscordTokenResponseSchema>;

const RawDiscordOauthMeSchema = z.object({
  application: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
  scopes: z.array(z.string()),
});

const RawDiscordActivityInstanceSchema = z.object({
  application_id: z.string().min(1),
  instance_id: z.string().min(1),
  location: z.object({
    guild_id: z.string().min(1),
    channel_id: z.string().min(1),
  }),
  users: z.array(z.string().min(1)),
});

function customsConfiguration(): CustomsConfiguration {
  if (configuration.customs === undefined) {
    throw new Error("Scout Customs is not configured");
  }
  return configuration.customs;
}

function signingKey(config: CustomsConfiguration): Uint8Array {
  return new TextEncoder().encode(config.jwtSigningSecret);
}

function assertGuildAllowlisted(
  config: CustomsConfiguration,
  guildId: string,
): void {
  if (!config.guildAllowlist.includes(guildId))
    throw new CustomAuthHttpError(
      403,
      "This guild is not allowlisted for Scout Customs",
    );
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    const message = `Discord rejected Activity authentication (${response.status.toString()}): ${body.slice(0, 300)}`;
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      throw new CustomAuthHttpError(401, message);
    }
    throw new Error(message);
  }
  return JSON.parse(body);
}

async function requestDiscordToken(params: {
  fetcher: typeof fetch;
  grant: URLSearchParams;
}) {
  const response = await params.fetcher(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.grant,
  });
  return RawDiscordTokenResponseSchema.parse(await readJson(response));
}

async function validateDiscordIdentity(params: {
  accessToken: string;
  expectedApplicationId: string;
  fetcher: typeof fetch;
}): Promise<string> {
  const response = await params.fetcher(`${DISCORD_API_BASE}/oauth2/@me`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const oauth = RawDiscordOauthMeSchema.parse(await readJson(response));
  if (oauth.application.id !== params.expectedApplicationId) {
    throw new CustomAuthHttpError(
      401,
      "Discord token belongs to a different application",
    );
  }
  if (
    !oauth.scopes.includes("identify") ||
    !oauth.scopes.includes("rpc.activities.write")
  ) {
    throw new CustomAuthHttpError(
      401,
      "Discord token is missing required Activity scopes",
    );
  }
  return oauth.user.id;
}

async function validateLiveInstance(params: {
  config: CustomsConfiguration;
  instanceId: string;
  guildId: string;
  channelId: string;
  discordId: string;
  fetcher: typeof fetch;
}): Promise<void> {
  const response = await params.fetcher(
    `${DISCORD_API_BASE}/applications/${params.config.applicationId}/activity-instances/${params.instanceId}`,
    { headers: { Authorization: `Bot ${params.config.botToken}` } },
  );
  const instance = RawDiscordActivityInstanceSchema.parse(
    await readJson(response),
  );
  if (
    instance.application_id !== params.config.applicationId ||
    instance.instance_id !== params.instanceId ||
    instance.location.guild_id !== params.guildId ||
    instance.location.channel_id !== params.channelId ||
    !instance.users.includes(params.discordId)
  ) {
    throw new CustomAuthHttpError(
      401,
      "Discord Activity instance context does not match the request",
    );
  }
}

async function signActivityToken(
  claims: CustomActivityClaims,
  config: CustomsConfiguration,
  now: Date,
): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(now.getTime() + ACTIVITY_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({
    guildId: claims.guildId,
    channelId: claims.channelId,
    instanceId: claims.instanceId,
    applicationId: claims.applicationId,
    type: claims.type,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("scout-customs")
    .setAudience("scout-customs-activity")
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(signingKey(config));
  return { token, expiresAt: expiresAt.toISOString() };
}

async function issueActivityAuth(params: {
  config: CustomsConfiguration;
  claims: CustomActivityClaims;
  discordToken: RawDiscordTokenResponse;
  fetcher: typeof fetch;
  now: Date;
}): Promise<CustomAuthResponse> {
  await validateLiveInstance({
    config: params.config,
    instanceId: params.claims.instanceId,
    guildId: params.claims.guildId,
    channelId: params.claims.channelId,
    discordId: params.claims.sub,
    fetcher: params.fetcher,
  });
  const signed = await signActivityToken(
    params.claims,
    params.config,
    params.now,
  );
  return CustomAuthResponseSchema.parse({
    discordAccessToken: params.discordToken.access_token,
    discordRefreshToken: params.discordToken.refresh_token,
    activityToken: signed.token,
    expiresAt: signed.expiresAt,
    contractHash: configuration.contractHash,
  });
}

export async function verifyCustomActivityToken(
  token: string,
): Promise<CustomActivityClaims | null> {
  const session = await verifyCustomActivityTokenWithExpiry(token);
  return session?.claims ?? null;
}

export function isCustomActivityTokenCandidate(token: string): boolean {
  const segments = token.split(".");
  return (
    segments.length === 3 && segments.every((segment) => segment.length > 0)
  );
}

async function verifyActivityTokenWithTolerance(
  token: string,
  clockTolerance: number,
): Promise<{ claims: CustomActivityClaims; expiresAtMs: number } | null> {
  const config = configuration.customs;
  if (config === undefined) return null;
  try {
    const result = await jwtVerify(token, signingKey(config), {
      issuer: "scout-customs",
      audience: "scout-customs-activity",
      clockTolerance,
    });
    if (typeof result.payload.exp !== "number") return null;
    const claims = CustomActivityClaimsSchema.parse({
      ...result.payload,
      sub: result.payload.sub,
    });
    return { claims, expiresAtMs: result.payload.exp * 1000 };
  } catch {
    return null;
  }
}

export async function verifyCustomActivityTokenWithExpiry(
  token: string,
): Promise<{ claims: CustomActivityClaims; expiresAtMs: number } | null> {
  return await verifyActivityTokenWithTolerance(token, 0);
}

export async function exchangeCustomActivityAuth(
  rawInput: unknown,
  options?: { fetcher?: typeof fetch; now?: Date },
): Promise<CustomAuthResponse> {
  const input = CustomAuthExchangeInputSchema.parse(rawInput);
  const config = customsConfiguration();
  assertGuildAllowlisted(config, input.guildId);
  const fetcher = options?.fetcher ?? fetch;
  const discordToken = await requestDiscordToken({
    fetcher,
    grant: new URLSearchParams({
      client_id: config.applicationId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
    }),
  });
  const discordId = await validateDiscordIdentity({
    accessToken: discordToken.access_token,
    expectedApplicationId: config.applicationId,
    fetcher,
  });
  return await issueActivityAuth({
    config,
    claims: {
      sub: discordId,
      guildId: input.guildId,
      channelId: input.channelId,
      instanceId: input.instanceId,
      applicationId: config.applicationId,
      type: "customs_activity",
    },
    discordToken,
    fetcher,
    now: options?.now ?? new Date(),
  });
}

export async function refreshCustomActivityAuth(
  rawInput: unknown,
  options?: { fetcher?: typeof fetch; now?: Date },
): Promise<CustomAuthResponse> {
  const input = CustomAuthRefreshInputSchema.parse(rawInput);
  const session = await verifyActivityTokenWithTolerance(
    input.activityToken,
    ACTIVITY_REFRESH_GRACE_SECONDS,
  );
  if (session === null)
    throw new CustomAuthHttpError(
      401,
      "Activity session is invalid or expired",
    );
  const { claims } = session;
  const config = customsConfiguration();
  assertGuildAllowlisted(config, claims.guildId);
  const fetcher = options?.fetcher ?? fetch;
  const discordToken = await requestDiscordToken({
    fetcher,
    grant: new URLSearchParams({
      client_id: config.applicationId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.discordRefreshToken,
    }),
  });
  const discordId = await validateDiscordIdentity({
    accessToken: discordToken.access_token,
    expectedApplicationId: config.applicationId,
    fetcher,
  });
  if (discordId !== claims.sub)
    throw new CustomAuthHttpError(
      401,
      "Discord identity changed during Activity refresh",
    );
  return await issueActivityAuth({
    config,
    claims,
    discordToken,
    fetcher,
    now: options?.now ?? new Date(),
  });
}

async function parseRequestJson(request: Request): Promise<unknown> {
  const body = await request.text();
  return JSON.parse(body);
}

export async function handleCustomAuthRoutes(
  request: Request,
  url: URL,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (
    url.pathname !== "/api/customs/auth/exchange" &&
    url.pathname !== "/api/customs/auth/refresh"
  ) {
    return null;
  }
  if (request.method !== "POST")
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });

  let rawInput: unknown;
  try {
    rawInput = await parseRequestJson(request);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Request body must be valid JSON" },
        { status: 400, headers: corsHeaders },
      );
    }
    logger.error("Failed to read Activity authentication request", { error });
    return Response.json(
      { error: "Activity authentication failed" },
      { status: 500, headers: corsHeaders },
    );
  }

  const input = url.pathname.endsWith("/exchange")
    ? CustomAuthExchangeInputSchema.safeParse(rawInput)
    : CustomAuthRefreshInputSchema.safeParse(rawInput);
  if (!input.success) {
    return Response.json(
      { error: "Request body does not match the authentication contract" },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const result = url.pathname.endsWith("/exchange")
      ? await exchangeCustomActivityAuth(input.data)
      : await refreshCustomActivityAuth(input.data);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof CustomAuthHttpError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: corsHeaders },
      );
    }
    logger.error("Unexpected Activity authentication failure", { error });
    return Response.json(
      { error: "Activity authentication failed" },
      { status: 500, headers: corsHeaders },
    );
  }
}

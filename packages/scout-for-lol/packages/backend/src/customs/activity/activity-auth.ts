import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import {
  CustomActivityClaimsSchema,
  CustomAuthExchangeInputSchema,
  CustomAuthRefreshInputSchema,
  CustomAuthResponseSchema,
  DiscordGuildIdSchema,
  type CustomActivityClaims,
  type CustomAuthResponse,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { client as discordClient } from "#src/discord/client.ts";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_REQUEST_TIMEOUT_MS = 10_000;
const ACTIVITY_TOKEN_TTL_SECONDS = 10 * 60;
const ACTIVITY_REFRESH_WINDOW_SECONDS = 2 * 60 * 60;
export const CUSTOMS_ISSUER = "scout-customs";
export const CUSTOMS_AUDIENCE = "scout-customs-activity";
export function isAllowedCustomActivityOrigin(origin: string | null): boolean {
  if (origin === null) return false;
  try {
    const url = new URL(origin);
    const configuredOrigin = new URL(
      configuration.webAppOrigin ?? "https://scout-for-lol.com",
    ).origin;
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".discordsays.com") ||
        url.origin === configuredOrigin)
    );
  } catch {
    return false;
  }
}

export class CustomAuthHttpError extends Error {
  readonly status: 401 | 403 | 503;

  constructor(
    status: 401 | 403 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.status = status;
  }
}

const DiscordTokenSchema = z.strictObject({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string(),
});
type DiscordToken = z.infer<typeof DiscordTokenSchema>;

const DiscordOauthMeSchema = z.object({
  application: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
  scopes: z.array(z.string()),
});

const DiscordActivityInstanceSchema = z.object({
  application_id: z.string().min(1),
  instance_id: z.string().min(1),
  location: z.object({
    guild_id: z.string().min(1),
    channel_id: z.string().min(1),
  }),
  users: z.array(z.object({ id: z.string().min(1) })),
});

type ActivityFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type ActivityAuthDependencies = {
  readonly fetcher: ActivityFetcher;
  readonly now: () => Date;
  readonly assertMember: (claims: CustomActivityClaims) => Promise<void>;
};

function requireSigningKey(): Uint8Array {
  const secret = configuration.jwtSigningSecret;
  if (secret === undefined || secret.length < 32) {
    throw new CustomAuthHttpError(
      503,
      "Scout Activity session signing is unavailable",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function assertCustomGuildMember(
  claims: CustomActivityClaims,
): Promise<void> {
  if (claims.applicationId !== configuration.applicationId) {
    throw new CustomAuthHttpError(401, "Activity application mismatch");
  }
  const guild = discordClient.guilds.cache.get(claims.guildId);
  if (guild === undefined) {
    throw new CustomAuthHttpError(403, "Scout is not installed in this guild");
  }
  try {
    await guild.members.fetch(claims.sub);
  } catch (error) {
    throw new CustomAuthHttpError(403, "Activity guild membership required", {
      cause: error,
    });
  }
}

const DEFAULT_DEPENDENCIES: ActivityAuthDependencies = {
  fetcher: fetch,
  now: () => new Date(),
  assertMember: assertCustomGuildMember,
};

export async function assertCustomActivityPolicy(
  claims: CustomActivityClaims,
  assertMember: ActivityAuthDependencies["assertMember"] = DEFAULT_DEPENDENCIES.assertMember,
): Promise<void> {
  if (claims.applicationId !== configuration.applicationId) {
    throw new CustomAuthHttpError(401, "Activity application mismatch");
  }
  const guildId = DiscordGuildIdSchema.parse(claims.guildId);
  if (!(await isPolicyEnabled("custom_nights_enabled", { server: guildId }))) {
    throw new CustomAuthHttpError(
      403,
      "Scout custom nights are not enabled in this guild",
    );
  }
  await assertMember(claims);
}

async function requestDiscord(
  fetcher: ActivityFetcher,
  input: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(input, {
      ...init,
      signal: AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CustomAuthHttpError(
      503,
      "Discord Activity authentication is unavailable",
      { cause: error },
    );
  }
  const text = await response.text();
  if (!response.ok) {
    const status =
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
        ? 401
        : 503;
    throw new CustomAuthHttpError(
      status,
      `Discord rejected Activity authentication (${response.status.toString()})`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CustomAuthHttpError(
      503,
      "Discord returned malformed Activity authentication data",
      { cause: error },
    );
  }
}

async function requestDiscordToken(
  dependencies: ActivityAuthDependencies,
  grant: URLSearchParams,
): Promise<DiscordToken> {
  if (configuration.discordClientSecret === undefined) {
    throw new CustomAuthHttpError(503, "Discord OAuth exchange is unavailable");
  }
  return DiscordTokenSchema.parse(
    await requestDiscord(
      dependencies.fetcher,
      `${DISCORD_API_BASE}/oauth2/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: grant,
      },
    ),
  );
}

async function discordIdentity(
  dependencies: ActivityAuthDependencies,
  accessToken: string,
): Promise<string> {
  const oauth = DiscordOauthMeSchema.parse(
    await requestDiscord(
      dependencies.fetcher,
      `${DISCORD_API_BASE}/oauth2/@me`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ),
  );
  if (oauth.application.id !== configuration.applicationId) {
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
      "Discord token is missing Activity scopes",
    );
  }
  return oauth.user.id;
}

async function assertLiveInstance(
  dependencies: ActivityAuthDependencies,
  claims: CustomActivityClaims,
): Promise<void> {
  const instance = DiscordActivityInstanceSchema.parse(
    await requestDiscord(
      dependencies.fetcher,
      `${DISCORD_API_BASE}/applications/${configuration.applicationId}/activity-instances/${claims.instanceId}`,
      { headers: { Authorization: `Bot ${configuration.discordToken}` } },
    ),
  );
  if (
    instance.application_id !== claims.applicationId ||
    instance.instance_id !== claims.instanceId ||
    instance.location.guild_id !== claims.guildId ||
    instance.location.channel_id !== claims.channelId ||
    !instance.users.some((user) => user.id === claims.sub)
  ) {
    throw new CustomAuthHttpError(
      401,
      "Discord Activity instance context does not match the request",
    );
  }
}

async function signActivityToken(
  claims: CustomActivityClaims,
  now: Date,
  refreshUntil: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + ACTIVITY_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({
    guildId: claims.guildId,
    channelId: claims.channelId,
    instanceId: claims.instanceId,
    applicationId: claims.applicationId,
    type: claims.type,
    refreshUntil: Math.floor(refreshUntil.getTime() / 1000),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(CUSTOMS_ISSUER)
    .setAudience(CUSTOMS_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(requireSigningKey());
  return { token, expiresAt };
}

async function issueAuth(
  dependencies: ActivityAuthDependencies,
  claims: CustomActivityClaims,
  discordToken: DiscordToken,
  refreshUntil: Date,
): Promise<CustomAuthResponse> {
  await assertLiveInstance(dependencies, claims);
  await assertCustomActivityPolicy(claims, dependencies.assertMember);
  const signed = await signActivityToken(
    claims,
    dependencies.now(),
    refreshUntil,
  );
  return CustomAuthResponseSchema.parse({
    discordAccessToken: discordToken.access_token,
    discordRefreshToken: discordToken.refresh_token,
    activityToken: signed.token,
    expiresAt: signed.expiresAt.toISOString(),
    refreshUntil: refreshUntil.toISOString(),
    contractHash: configuration.contractHash,
  });
}

type VerifiedActivitySession = {
  readonly claims: CustomActivityClaims;
  readonly expiresAtMs: number;
  readonly refreshUntilMs: number;
};

async function verifyActivityToken(
  token: string,
  allowExpired: boolean,
  now: Date,
): Promise<VerifiedActivitySession | null> {
  try {
    const result = await jwtVerify(token, requireSigningKey(), {
      issuer: CUSTOMS_ISSUER,
      audience: CUSTOMS_AUDIENCE,
      currentDate: now,
      ...(allowExpired
        ? { clockTolerance: ACTIVITY_REFRESH_WINDOW_SECONDS }
        : {}),
    });
    if (
      typeof result.payload.exp !== "number" ||
      typeof result.payload["refreshUntil"] !== "number"
    ) {
      return null;
    }
    const claims = CustomActivityClaimsSchema.parse({
      sub: result.payload.sub,
      guildId: result.payload["guildId"],
      channelId: result.payload["channelId"],
      instanceId: result.payload["instanceId"],
      applicationId: result.payload["applicationId"],
      type: result.payload["type"],
    });
    return {
      claims,
      expiresAtMs: result.payload.exp * 1000,
      refreshUntilMs: result.payload["refreshUntil"] * 1000,
    };
  } catch {
    return null;
  }
}

export function isCustomActivityTokenCandidate(token: string): boolean {
  const segments = token.split(".");
  return (
    segments.length === 3 && segments.every((segment) => segment.length > 0)
  );
}

export async function verifyCustomActivityTokenWithExpiry(
  token: string,
  now: Date = new Date(),
): Promise<VerifiedActivitySession | null> {
  return verifyActivityToken(token, false, now);
}

export async function verifyCustomActivityToken(
  token: string,
): Promise<CustomActivityClaims | null> {
  const session = await verifyCustomActivityTokenWithExpiry(token);
  return session?.claims ?? null;
}

function withDependencies(
  options: Partial<ActivityAuthDependencies> | undefined,
): ActivityAuthDependencies {
  return {
    fetcher: options?.fetcher ?? DEFAULT_DEPENDENCIES.fetcher,
    now: options?.now ?? DEFAULT_DEPENDENCIES.now,
    assertMember: options?.assertMember ?? DEFAULT_DEPENDENCIES.assertMember,
  };
}

export async function exchangeCustomActivityAuth(
  rawInput: unknown,
  options?: Partial<ActivityAuthDependencies>,
): Promise<CustomAuthResponse> {
  const input = CustomAuthExchangeInputSchema.parse(rawInput);
  const dependencies = withDependencies(options);
  const discordToken = await requestDiscordToken(
    dependencies,
    new URLSearchParams({
      client_id: configuration.applicationId,
      client_secret: configuration.discordClientSecret ?? "",
      grant_type: "authorization_code",
      code: input.code,
    }),
  );
  const discordId = await discordIdentity(
    dependencies,
    discordToken.access_token,
  );
  const claims = CustomActivityClaimsSchema.parse({
    sub: discordId,
    guildId: input.guildId,
    channelId: input.channelId,
    instanceId: input.instanceId,
    applicationId: configuration.applicationId,
    type: "customs_activity",
  });
  const refreshUntil = new Date(
    dependencies.now().getTime() + ACTIVITY_REFRESH_WINDOW_SECONDS * 1000,
  );
  return issueAuth(dependencies, claims, discordToken, refreshUntil);
}

export async function refreshCustomActivityAuth(
  rawInput: unknown,
  options?: Partial<ActivityAuthDependencies>,
): Promise<CustomAuthResponse> {
  const input = CustomAuthRefreshInputSchema.parse(rawInput);
  const dependencies = withDependencies(options);
  const session = await verifyActivityToken(
    input.activityToken,
    true,
    dependencies.now(),
  );
  if (
    session === null ||
    dependencies.now().getTime() > session.refreshUntilMs
  ) {
    throw new CustomAuthHttpError(
      401,
      "Activity session is invalid or expired",
    );
  }
  const discordToken = await requestDiscordToken(
    dependencies,
    new URLSearchParams({
      client_id: configuration.applicationId,
      client_secret: configuration.discordClientSecret ?? "",
      grant_type: "refresh_token",
      refresh_token: input.discordRefreshToken,
    }),
  );
  const discordId = await discordIdentity(
    dependencies,
    discordToken.access_token,
  );
  if (discordId !== session.claims.sub) {
    throw new CustomAuthHttpError(
      401,
      "Discord identity changed during Activity refresh",
    );
  }
  return issueAuth(
    dependencies,
    session.claims,
    discordToken,
    new Date(session.refreshUntilMs),
  );
}

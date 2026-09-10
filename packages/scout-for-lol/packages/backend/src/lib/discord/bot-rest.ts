/**
 * Authoritative Discord reads for web requests, over the BOT token's REST API.
 *
 * This is the application port that replaces `client.guilds.cache` on every
 * HTTP/tRPC path. The gateway cache cannot back a web request honestly: an
 * unconnected or still-backfilling client is indistinguishable from "Scout is
 * not installed there", so an ordinary pod restart used to hand real members a
 * NOT_FOUND. REST answers the same questions without a gateway connection, and
 * an unreachable REST is *reported* as unreachable instead of being silently
 * rewritten into a permission answer.
 *
 * Three outcomes are kept distinct and callers must preserve the distinction:
 *
 * - a value — Discord answered;
 * - `null` / `false` — Discord authoritatively said the thing does not exist
 *   (Unknown Guild/Member/User), which for a guild means Scout is not in it;
 * - a thrown {@link DiscordUpstreamError} — Scout could not obtain an answer.
 *   `trpc/discord-upstream.ts` turns that into SERVICE_UNAVAILABLE. It must
 *   never become "not installed" or FORBIDDEN.
 *
 * Token wiring follows `src/discord/rest.ts`: its own `REST` instance carrying
 * the bot token, so it works whether or not `client.login()` was ever called.
 *
 * ## Cache TTLs
 *
 * Every read is memoized in a bounded TTL cache (which also collapses
 * concurrent identical reads into one request). The TTLs are chosen to be
 * defensible for the decisions they feed:
 *
 * - channels / roles / the bot's own member — {@link PERMISSION_TTL_MS} (60s).
 *   These three feed channel permission checks. A moved channel or an edited
 *   role takes at most a minute to be reflected in the channel picker, which is
 *   the same order of staleness the gateway cache had under a lagging shard,
 *   and a stale answer here can only mis-*offer* a channel: every write is
 *   re-checked by Discord itself when Scout actually posts.
 * - a single member lookup — {@link MEMBERSHIP_TTL_MS} (30s). Shorter, because
 *   this one gates access decisions (the last-role-manager check, Activity
 *   membership): losing access should not lag by a whole minute.
 * - guild existence — {@link INSTALL_TTL_MS} (60s). Only ever consulted after
 *   the `GuildInstall` port has already said "no row" (see
 *   `installed-guilds.ts`), and a fresh install writes that row immediately, so
 *   this TTL delays nothing a user waits on.
 * - user profiles — {@link USER_TTL_MS} (5m), matching the display-name cache
 *   this replaced. Names and avatars are cosmetic.
 *
 * Member *search* is deliberately uncached: it is keyed by a free-text query,
 * so a cache would be unbounded in keys while a typeahead re-queries on every
 * keystroke anyway.
 */

import { CDN, REST, Routes } from "discord.js";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import {
  DiscordChannelSchema,
  DiscordGuildChannelsSchema,
  DiscordGuildMemberSchema,
  DiscordGuildMembersSchema,
  DiscordRolesSchema,
  DiscordUserSchema,
  type DiscordChannel,
  type DiscordGuildChannel,
  type DiscordGuildMember,
  type DiscordRole,
  type DiscordUser,
} from "#src/lib/discord/bot-rest-schemas.ts";
import { createLogger } from "#src/logger.ts";
import { createBoundedAsyncCache } from "#src/utils/bounded-async-cache.ts";

const logger = createLogger("discord-bot-rest");

export const PERMISSION_TTL_MS = 60 * 1000;
export const MEMBERSHIP_TTL_MS = 30 * 1000;
export const INSTALL_TTL_MS = 60 * 1000;
export const USER_TTL_MS = 5 * 60 * 1000;

/**
 * Bound the number of guilds held per cache. Well above any realistic burst of
 * distinct guilds in one TTL window, and small enough that a long-lived pod
 * cannot grow without limit.
 */
const MAX_CACHE_ENTRIES = 2000;
/** Cap concurrent outbound reads so one burst cannot saturate the REST pool. */
const MAX_CONCURRENT_READS = 8;
/**
 * Bound an inbound web request's wait on Discord. discord.js defaults to 15s,
 * which is long enough for a stalled upstream to hold tRPC requests open.
 */
const REST_TIMEOUT_MS = 5000;

/** Discord "this does not exist" error codes. */
const UNKNOWN_CHANNEL = 10_003;
const UNKNOWN_GUILD = 10_004;
const UNKNOWN_MEMBER = 10_007;
const UNKNOWN_USER = 10_013;

const DiscordApiErrorSchema = z.object({
  code: z.number(),
  status: z.number().optional(),
});
const HttpErrorSchema = z.object({ status: z.number() });

/** The single transport seam; tests substitute this instead of the network. */
export type BotRestGet = (
  route: `/${string}`,
  options?: { readonly query?: URLSearchParams },
) => Promise<unknown>;

let sharedRest: REST | undefined;

/**
 * The bot-token REST client, created on first use.
 *
 * Lazy so that importing this module does not require `DISCORD_TOKEN` — unit
 * tests inject {@link BotRestGet} and never reach the network.
 */
function sharedGet(): BotRestGet {
  sharedRest ??= new REST({
    timeout: REST_TIMEOUT_MS,
    retries: 1,
  }).setToken(configuration.discordToken);
  const rest = sharedRest;
  return async (route, options) =>
    await rest.get(
      route,
      options?.query === undefined ? {} : { query: options.query },
    );
}

function discordErrorCode(error: unknown): number | undefined {
  const parsed = DiscordApiErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

function upstreamError(
  error: unknown,
  description: string,
): DiscordUpstreamError {
  const api = DiscordApiErrorSchema.safeParse(error);
  const http = HttpErrorSchema.safeParse(error);
  const status = api.success
    ? api.data.status
    : http.success
      ? http.data.status
      : undefined;
  logger.warn(`Discord bot REST failed: ${description}`, { status, error });
  return new DiscordUpstreamError(
    status === undefined ? "fetch_error" : "http_error",
    `Discord bot REST request failed: ${description}`,
    status,
  );
}

type ReadRequest<Parsed> = {
  readonly route: `/${string}`;
  readonly schema: z.ZodType<Parsed>;
  readonly description: string;
  /**
   * Discord error codes that mean "this authoritatively does not exist" for
   * this route, and so resolve to `null` rather than an upstream failure.
   */
  readonly absentCodes: readonly number[];
  readonly query?: URLSearchParams;
};

/**
 * Perform one read, returning `null` for an authoritative "does not exist" and
 * throwing {@link DiscordUpstreamError} for everything else.
 */
async function read<Parsed>(
  get: BotRestGet,
  request: ReadRequest<Parsed>,
): Promise<Parsed | null> {
  let body: unknown;
  try {
    body = await get(
      request.route,
      request.query === undefined ? undefined : { query: request.query },
    );
  } catch (error) {
    const code = discordErrorCode(error);
    if (code !== undefined && request.absentCodes.includes(code)) return null;
    throw upstreamError(error, request.description);
  }
  const parsed = request.schema.safeParse(body);
  if (!parsed.success) {
    logger.warn(`Discord bot REST schema mismatch: ${request.description}`, {
      issues: parsed.error.issues.slice(0, 3),
    });
    throw new DiscordUpstreamError(
      "schema_error",
      `Discord returned an unexpected shape: ${request.description}`,
    );
  }
  return parsed.data;
}

/**
 * The authoritative Discord reads a web request may need.
 *
 * A `null` result always means Discord said the resource does not exist —
 * never that Scout failed to ask.
 */
export type BotRestReader = {
  /** Whether Scout is a member of the guild, straight from Discord. */
  readonly guildExists: (guildId: string) => Promise<boolean>;
  /** `null` when Scout is not in the guild. */
  readonly guildChannels: (
    guildId: string,
  ) => Promise<DiscordGuildChannel[] | null>;
  /** `null` when Scout is not in the guild. */
  readonly guildRoles: (guildId: string) => Promise<DiscordRole[] | null>;
  /** Scout's own member row, for channel permission checks. */
  readonly botMember: (guildId: string) => Promise<DiscordGuildMember | null>;
  /** `null` when the user is not a member (or Scout is not in the guild). */
  readonly guildMember: (
    guildId: string,
    userId: string,
  ) => Promise<DiscordGuildMember | null>;
  /** Prefix search over usernames and nicknames. Empty when Scout is absent. */
  readonly searchGuildMembers: (input: {
    guildId: string;
    query: string;
    limit: number;
  }) => Promise<DiscordGuildMember[]>;
  readonly user: (userId: string) => Promise<DiscordUser | null>;
  /**
   * One channel by id, uncached and NOT guild-scoped — the caller must check
   * `guild_id` itself. For the case where the id came from outside Scout (a
   * Discord Activity launch) rather than from a list Scout offered, so a
   * seconds-old channel must resolve rather than wait out a cache TTL.
   */
  readonly channel: (channelId: string) => Promise<DiscordChannel | null>;
  /** Drop every cached answer. Test-only; the caches are process singletons. */
  readonly clearCaches: () => void;
};

export type BotRestReaderOptions = {
  readonly get?: BotRestGet;
  readonly now?: () => number;
  /** The bot user's id. For a Discord bot this equals the application id. */
  readonly botUserId?: string;
};

export function createBotRestReader(
  options: BotRestReaderOptions = {},
): BotRestReader {
  const get = options.get ?? sharedGet();
  const now = options.now ?? (() => Date.now());
  const cacheOptions = (ttlMs: number) => ({
    ttlMs,
    maxEntries: MAX_CACHE_ENTRIES,
    maxConcurrent: MAX_CONCURRENT_READS,
    now,
  });

  const guildCache = createBoundedAsyncCache<boolean>(
    cacheOptions(INSTALL_TTL_MS),
  );
  const channelCache = createBoundedAsyncCache<DiscordGuildChannel[] | null>(
    cacheOptions(PERMISSION_TTL_MS),
  );
  const roleCache = createBoundedAsyncCache<DiscordRole[] | null>(
    cacheOptions(PERMISSION_TTL_MS),
  );
  const botMemberCache = createBoundedAsyncCache<DiscordGuildMember | null>(
    cacheOptions(PERMISSION_TTL_MS),
  );
  const memberCache = createBoundedAsyncCache<DiscordGuildMember | null>(
    cacheOptions(MEMBERSHIP_TTL_MS),
  );
  const userCache = createBoundedAsyncCache<DiscordUser | null>(
    cacheOptions(USER_TTL_MS),
  );

  const botUserId = () => options.botUserId ?? configuration.applicationId;

  const readBotMember = async (guildId: string) =>
    await read(get, {
      route: Routes.guildMember(guildId, botUserId()),
      schema: DiscordGuildMemberSchema,
      description: `guild ${guildId} bot member`,
      // 10007 here means Scout is not in the guild, same as 10004.
      absentCodes: [UNKNOWN_GUILD, UNKNOWN_MEMBER],
    });

  return {
    guildExists: async (guildId) =>
      await guildCache(
        guildId,
        async () =>
          (await read(get, {
            route: Routes.guild(guildId),
            schema: z.object({ id: z.string() }),
            description: `guild ${guildId}`,
            absentCodes: [UNKNOWN_GUILD],
          })) !== null,
      ),

    guildChannels: async (guildId) =>
      await channelCache(
        guildId,
        async () =>
          await read(get, {
            route: Routes.guildChannels(guildId),
            schema: DiscordGuildChannelsSchema,
            description: `guild ${guildId} channels`,
            absentCodes: [UNKNOWN_GUILD],
          }),
      ),

    guildRoles: async (guildId) =>
      await roleCache(
        guildId,
        async () =>
          await read(get, {
            route: Routes.guildRoles(guildId),
            schema: DiscordRolesSchema,
            description: `guild ${guildId} roles`,
            absentCodes: [UNKNOWN_GUILD],
          }),
      ),

    botMember: async (guildId) =>
      await botMemberCache(guildId, async () => await readBotMember(guildId)),

    guildMember: async (guildId, userId) =>
      await memberCache(
        `${guildId}:${userId}`,
        async () =>
          await read(get, {
            route: Routes.guildMember(guildId, userId),
            schema: DiscordGuildMemberSchema,
            description: `guild ${guildId} member ${userId}`,
            absentCodes: [UNKNOWN_GUILD, UNKNOWN_MEMBER],
          }),
      ),

    searchGuildMembers: async (input) =>
      (await read(get, {
        route: Routes.guildMembersSearch(input.guildId),
        schema: DiscordGuildMembersSchema,
        description: `guild ${input.guildId} member search`,
        absentCodes: [UNKNOWN_GUILD],
        query: new URLSearchParams({
          query: input.query,
          limit: input.limit.toString(),
        }),
      })) ?? [],

    user: async (userId) =>
      await userCache(
        userId,
        async () =>
          await read(get, {
            route: Routes.user(userId),
            schema: DiscordUserSchema,
            description: `user ${userId}`,
            absentCodes: [UNKNOWN_USER],
          }),
      ),

    channel: async (channelId) =>
      await read(get, {
        route: Routes.channel(channelId),
        schema: DiscordChannelSchema,
        description: `channel ${channelId}`,
        absentCodes: [UNKNOWN_CHANNEL],
      }),

    clearCaches: () => {
      guildCache.clear();
      channelCache.clear();
      roleCache.clear();
      botMemberCache.clear();
      memberCache.clear();
      userCache.clear();
    },
  };
}

let sharedReader: BotRestReader | undefined;

/** The process-wide reader. Call sites take it as an injectable default. */
export function botRest(): BotRestReader {
  sharedReader ??= createBotRestReader();
  return sharedReader;
}

const cdn = new CDN();

/** The display name Discord would show for a member inside their guild. */
export function memberDisplayName(member: DiscordGuildMember): string {
  return member.nick ?? member.user.global_name ?? member.user.username;
}

/** The avatar Discord would show for a user, honouring a per-guild override. */
export function memberAvatarUrl(
  member: DiscordGuildMember,
  guildId: string,
): string {
  if (member.avatar !== null && member.avatar !== undefined) {
    return cdn.guildMemberAvatar(guildId, member.user.id, member.avatar);
  }
  return userAvatarUrl(member.user);
}

/**
 * The avatar Discord would show for a user with no guild context. Mirrors
 * discord.js `User#displayAvatarURL`, including the default-avatar fallback:
 * migrated accounts (`discriminator === "0"`) index by snowflake, legacy ones
 * by their four-digit tag.
 */
export function userAvatarUrl(user: DiscordUser): string {
  if (user.avatar !== null && user.avatar !== undefined) {
    return cdn.avatar(user.id, user.avatar);
  }
  const legacyTag =
    user.discriminator === null ||
    user.discriminator === undefined ||
    user.discriminator === "0"
      ? undefined
      : Number.parseInt(user.discriminator, 10);
  const index =
    legacyTag === undefined || Number.isNaN(legacyTag)
      ? Number(BigInt(user.id) >> 22n) % 6
      : legacyTag % 5;
  return cdn.defaultAvatar(index);
}

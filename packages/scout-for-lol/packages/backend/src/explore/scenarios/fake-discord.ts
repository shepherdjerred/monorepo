import { ChannelType, Routes } from "discord.js";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { BotRestGet } from "#src/lib/discord/bot-rest.ts";
import type {
  DiscordGuildChannel,
  DiscordGuildMember,
  DiscordUser,
} from "#src/lib/discord/bot-rest-schemas.ts";
import type {
  ScenarioMember,
  ScenarioWorld,
} from "#src/explore/scenarios/world.ts";

/**
 * Discord, as the seeded worlds describe it.
 *
 * Explore's creation and member tools read guilds, channels, roles and members
 * over bot REST. A scenario runs with no bot token, so the harness installs a
 * reader over this transport instead, and the real reader code — caching,
 * schema parsing, "absent" handling — runs unchanged on top of it.
 *
 * Unknown ids answer with Discord's own "unknown" error codes, so a tool that
 * asks about a guild the world does not contain sees exactly what it would see
 * in production.
 */

const UNKNOWN_CHANNEL = 10_003;
const UNKNOWN_GUILD = 10_004;
const UNKNOWN_MEMBER = 10_007;
const UNKNOWN_USER = 10_013;
/** Administrator, so the bot can post in every fixture channel. */
const ADMINISTRATOR = "8";
const MEMBER_SEARCH = /^\/guilds\/(\d+)\/members\/search$/;

function unknown(code: number): never {
  // The reader tells absence from failure by the API error code, the field a
  // discord.js DiscordAPIError carries.
  throw Object.assign(new Error(`Discord error ${code.toString()}`), {
    code,
    status: 404,
  });
}

function toUser(member: ScenarioMember): DiscordUser {
  return {
    id: member.id,
    username: member.username,
    global_name: member.displayName,
    discriminator: "0",
    avatar: null,
  };
}

function toMember(member: ScenarioMember): DiscordGuildMember {
  return {
    user: toUser(member),
    nick: null,
    avatar: null,
    joined_at: "2026-01-01T00:00:00.000Z",
    roles: [],
  };
}

/** Every fixed route one world answers, keyed by the exact route string. */
function worldRoutes(
  world: ScenarioWorld,
  bot: ScenarioMember,
): ReadonlyMap<string, unknown> {
  const channels: DiscordGuildChannel[] = world.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    type: ChannelType.GuildText,
    parent_id: null,
    permission_overwrites: [],
  }));
  const routes = new Map<string, unknown>([
    [
      Routes.guild(world.guildId),
      { id: world.guildId, name: world.guildName, owner_id: world.asker.id },
    ],
    [Routes.guildChannels(world.guildId), channels],
    [
      Routes.guildRoles(world.guildId),
      [{ id: world.guildId, name: "@everyone", permissions: ADMINISTRATOR }],
    ],
    [Routes.guildMember(world.guildId, bot.id), toMember(bot)],
  ]);
  for (const member of world.members) {
    routes.set(Routes.guildMember(world.guildId, member.id), toMember(member));
    routes.set(Routes.user(member.id), toUser(member));
  }
  for (const channel of channels) {
    routes.set(Routes.channel(channel.id), {
      ...channel,
      guild_id: world.guildId,
    });
  }
  return routes;
}

function searchMembers(
  world: ScenarioWorld,
  query: URLSearchParams | undefined,
): DiscordGuildMember[] {
  const prefix = (query?.get("query") ?? "").toLowerCase();
  const limit = Number(query?.get("limit") ?? "10");
  return world.members
    .filter(
      (member) =>
        member.username.toLowerCase().startsWith(prefix) ||
        member.displayName.toLowerCase().startsWith(prefix),
    )
    .slice(0, limit)
    .map((member) => toMember(member));
}

function absent(route: string, worlds: readonly ScenarioWorld[]): never {
  if (route.startsWith("/guilds/")) {
    const guildId = route.split("/")[2] ?? "";
    unknown(
      worlds.some((world) => world.guildId === guildId)
        ? UNKNOWN_MEMBER
        : UNKNOWN_GUILD,
    );
  }
  if (route.startsWith("/channels/")) unknown(UNKNOWN_CHANNEL);
  if (route.startsWith("/users/")) unknown(UNKNOWN_USER);
  throw new Error(`The scenario Discord fixture does not serve ${route}.`);
}

export function scenarioDiscordTransport(input: {
  readonly worlds: () => readonly ScenarioWorld[];
  readonly botUserId: string;
}): BotRestGet {
  const bot: ScenarioMember = {
    id: DiscordAccountIdSchema.parse(input.botUserId),
    username: "Scout",
    displayName: "Scout",
  };

  return async (route, options) => {
    await Promise.resolve();
    const worlds = input.worlds();
    const search = MEMBER_SEARCH.exec(route);
    if (search !== null) {
      const world = worlds.find((candidate) => candidate.guildId === search[1]);
      if (world === undefined) unknown(UNKNOWN_GUILD);
      return searchMembers(world, options?.query);
    }
    for (const world of worlds) {
      const routes = worldRoutes(world, bot);
      if (routes.has(route)) return routes.get(route);
    }
    return absent(route, worlds);
  };
}

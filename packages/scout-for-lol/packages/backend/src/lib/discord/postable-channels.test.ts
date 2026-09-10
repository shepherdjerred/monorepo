import { describe, expect, test } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import type { DiscordGuildChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import { listPostableChannels } from "#src/lib/discord/postable-channels.ts";
import { testGuildId } from "#src/testing/test-ids.ts";

const GUILD = testGuildId("801");
const GUILD_ID = DiscordGuildIdSchema.parse(GUILD);
const BOT = "900";
const BOT_ROLE = "901";

const VIEW_AND_SEND = (
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages
).toString();

type Overwrite = DiscordGuildChannel["permission_overwrites"][number];

function channel(input: {
  id: string;
  name: string;
  type: number;
  parentId?: string | null;
  overwrites?: Overwrite[];
}): DiscordGuildChannel {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    parent_id: input.parentId ?? null,
    permission_overwrites: input.overwrites ?? [],
  };
}

function unused(): never {
  throw new Error("not used by listPostableChannels");
}

function rest(overrides: Partial<BotRestReader>): BotRestReader {
  return {
    guild: unused,
    guildExists: unused,
    guildChannels: unused,
    guildRoles: unused,
    botMember: unused,
    guildMember: unused,
    freshGuildMember: unused,
    searchGuildMembers: unused,
    user: unused,
    channel: unused,
    clearCaches: () => {
      /* no cache in the stub */
    },
    ...overrides,
  };
}

function reader(input: {
  channels: DiscordGuildChannel[] | null;
  botRolePermissions?: string;
}): BotRestReader {
  return rest({
    guildChannels: () => Promise.resolve(input.channels),
    guildRoles: () =>
      Promise.resolve([
        { id: GUILD, name: "@everyone", permissions: "0" },
        {
          id: BOT_ROLE,
          name: "Scout",
          permissions: input.botRolePermissions ?? VIEW_AND_SEND,
        },
      ]),
    botMember: () =>
      Promise.resolve({
        user: { id: BOT, username: "scout" },
        roles: [BOT_ROLE],
      }),
  });
}

describe("listPostableChannels", () => {
  test("offers text and announcement channels the bot can post in, by name", async () => {
    const channels = await listPostableChannels(GUILD_ID, {
      rest: reader({
        channels: [
          channel({ id: "2", name: "zulu", type: ChannelType.GuildText }),
          channel({ id: "1", name: "alpha", type: ChannelType.GuildText }),
          channel({
            id: "3",
            name: "news",
            type: ChannelType.GuildAnnouncement,
            parentId: "cat",
          }),
          channel({ id: "4", name: "voice", type: ChannelType.GuildVoice }),
          channel({
            id: "5",
            name: "Category",
            type: ChannelType.GuildCategory,
          }),
        ],
      }),
    });
    expect(channels).toEqual([
      { id: "1", name: "alpha", parentId: null },
      { id: "3", name: "news", parentId: "cat" },
      { id: "2", name: "zulu", parentId: null },
    ]);
  });

  test("omits channels an overwrite denies the bot", async () => {
    const channels = await listPostableChannels(GUILD_ID, {
      rest: reader({
        channels: [
          channel({ id: "1", name: "open", type: ChannelType.GuildText }),
          channel({
            id: "2",
            name: "locked",
            type: ChannelType.GuildText,
            overwrites: [
              {
                id: BOT_ROLE,
                type: 0,
                allow: "0",
                deny: PermissionFlagsBits.SendMessages.toString(),
              },
            ],
          }),
        ],
      }),
    });
    expect(channels.map((entry) => entry.id)).toEqual(["1"]);
  });

  test("returns nothing when the bot lacks Send Messages anywhere", async () => {
    const channels = await listPostableChannels(GUILD_ID, {
      rest: reader({
        channels: [
          channel({ id: "1", name: "open", type: ChannelType.GuildText }),
        ],
        botRolePermissions: PermissionFlagsBits.ViewChannel.toString(),
      }),
    });
    expect(channels).toEqual([]);
  });

  test("returns [] when Discord says Scout is not in the guild", async () => {
    const channels = await listPostableChannels(GUILD_ID, {
      rest: reader({ channels: null }),
    });
    expect(channels).toEqual([]);
  });

  test("an unreachable Discord throws instead of reading as 'no channels'", async () => {
    await expect(
      listPostableChannels(GUILD_ID, {
        rest: rest({
          guildChannels: () =>
            Promise.reject(new DiscordUpstreamError("http_error", "boom", 503)),
          guildRoles: () => Promise.resolve([]),
          botMember: () => Promise.resolve(null),
        }),
      }),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });
});

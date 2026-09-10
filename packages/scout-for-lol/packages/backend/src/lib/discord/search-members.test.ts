/**
 * The typeahead's failure contract: an empty list is an answer about the
 * roster, never a stand-in for "Scout could not ask Discord".
 */

import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import type { DiscordGuildMember } from "#src/lib/discord/bot-rest-schemas.ts";
import { searchGuildMembers } from "#src/lib/discord/search-members.ts";
import { testGuildId } from "#src/testing/test-ids.ts";

const GUILD = DiscordGuildIdSchema.parse(testGuildId("881"));

function unused(): never {
  throw new Error("not used by searchGuildMembers");
}

function reader(search: () => Promise<DiscordGuildMember[]>): BotRestReader {
  return {
    guild: unused,
    guildExists: unused,
    guildChannels: unused,
    guildRoles: unused,
    botMember: unused,
    guildMember: unused,
    freshGuildMember: unused,
    searchGuildMembers: search,
    user: unused,
    channel: unused,
    clearCaches: () => {
      /* no cache in the stub */
    },
  };
}

const input = { guildId: GUILD, query: "ali", limit: 10 };

describe("searchGuildMembers", () => {
  test("maps the members Discord returned", async () => {
    const results = await searchGuildMembers(input, {
      rest: reader(() =>
        Promise.resolve([
          {
            user: { id: "1", username: "alice", global_name: "Alice" },
            nick: "Al",
            avatar: null,
            roles: [],
          },
        ]),
      ),
    });
    expect(results).toEqual([
      {
        id: "1",
        username: "alice",
        displayName: "Al",
        avatar: expect.stringContaining("cdn.discordapp.com"),
      },
    ]);
  });

  test("a successful search with no matches is an empty list", async () => {
    // The ONLY thing that may produce []: Discord answered, nobody matched.
    await expect(
      searchGuildMembers(input, { rest: reader(() => Promise.resolve([])) }),
    ).resolves.toEqual([]);
  });

  test("a 403 propagates instead of blanking the typeahead", async () => {
    // A misconfigured install must not read as "that person is not in your
    // server" — that sends the user looking for a problem that isn't theirs.
    await expect(
      searchGuildMembers(input, {
        rest: reader(() =>
          Promise.reject(
            new DiscordUpstreamError("http_error", "Missing Access", 403),
          ),
        ),
      }),
    ).rejects.toMatchObject({ reason: "http_error", status: 403 });
  });

  test("a 5xx propagates", async () => {
    await expect(
      searchGuildMembers(input, {
        rest: reader(() =>
          Promise.reject(new DiscordUpstreamError("http_error", "boom", 503)),
        ),
      }),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });

  test("a network fault propagates", async () => {
    await expect(
      searchGuildMembers(input, {
        rest: reader(() =>
          Promise.reject(
            new DiscordUpstreamError("fetch_error", "socket hang up"),
          ),
        ),
      }),
    ).rejects.toBeInstanceOf(DiscordUpstreamError);
  });
});

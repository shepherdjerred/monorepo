import { describe, expect, test } from "bun:test";
import { glitterCorpusRuntimeConfig } from "./glitter-corpus-io.ts";
import {
  assertDiscordPageOrder,
  nextTraversalCursor,
} from "./glitter-corpus-page-order.ts";

function withRuntimeEnvironment<T>(
  denylist: string | undefined,
  action: () => T,
): T {
  const previous = {
    token: Bun.env["GLITTER_DISCORD_TOKEN"],
    guildId: Bun.env["GLITTER_DISCORD_GUILD_ID"],
    guildSlug: Bun.env["GLITTER_DISCORD_GUILD_SLUG"],
    denylist: Bun.env["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"],
  };
  Bun.env["GLITTER_DISCORD_TOKEN"] = "test-token";
  Bun.env["GLITTER_DISCORD_GUILD_ID"] = "123";
  Bun.env["GLITTER_DISCORD_GUILD_SLUG"] = "glitter-boys";
  if (denylist === undefined) {
    delete Bun.env["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"];
  } else {
    Bun.env["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"] = denylist;
  }
  try {
    return action();
  } finally {
    Bun.env["GLITTER_DISCORD_TOKEN"] = previous.token;
    Bun.env["GLITTER_DISCORD_GUILD_ID"] = previous.guildId;
    Bun.env["GLITTER_DISCORD_GUILD_SLUG"] = previous.guildSlug;
    Bun.env["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"] = previous.denylist;
  }
}

describe("Discord corpus page ordering", () => {
  test("accepts Discord's newest-to-oldest order for every cursor direction", () => {
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2", "1"],
        direction: "backward",
        objectKey: "backward.json",
      }),
    ).not.toThrow();
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2", "1"],
        direction: "forward",
        objectKey: "forward.json",
      }),
    ).not.toThrow();
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["3", "2", "1"],
        direction: "daily-overlap",
        objectKey: "overlap.json",
      }),
    ).not.toThrow();
  });

  test("rejects reversed and duplicate IDs", () => {
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["2", "3"],
        direction: "forward",
        objectKey: "reversed.json",
      }),
    ).toThrow("newest-to-oldest");
    expect(() =>
      assertDiscordPageOrder({
        messageIds: ["2", "2"],
        direction: "backward",
        objectKey: "duplicate.json",
      }),
    ).toThrow("newest-to-oldest");
  });

  test("advances multi-page traversal cursors from the correct page boundary", () => {
    expect(
      nextTraversalCursor({
        direction: "forward",
        messageIds: ["100", "90", "80"],
        previousCursor: "79",
      }),
    ).toBe("100");
    expect(
      nextTraversalCursor({
        direction: "forward",
        messageIds: ["120", "110", "101"],
        previousCursor: "100",
      }),
    ).toBe("120");
    expect(
      nextTraversalCursor({
        direction: "backward",
        messageIds: ["100", "90", "80"],
        previousCursor: undefined,
      }),
    ).toBe("80");
    expect(
      nextTraversalCursor({
        direction: "forward",
        messageIds: [],
        previousCursor: "120",
      }),
    ).toBe("120");
  });
});

describe("Glitter corpus runtime scope configuration", () => {
  test("requires an explicit denylist decision", () => {
    expect(() =>
      withRuntimeEnvironment(undefined, glitterCorpusRuntimeConfig),
    ).toThrow("must be present");
  });

  test("accepts an explicit blank denylist and parses configured channel IDs", () => {
    expect(
      withRuntimeEnvironment("", glitterCorpusRuntimeConfig)
        .denylistedChannelIds,
    ).toEqual([]);
    expect(
      withRuntimeEnvironment("200, 100", glitterCorpusRuntimeConfig)
        .denylistedChannelIds,
    ).toEqual(["200", "100"]);
  });
});

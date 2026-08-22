import { describe, expect, test } from "vitest";
import { MAX_LIST_ITEMS, buildListEmbed } from "#src/discord/commands/list.ts";
import type { SubscriptionListItem } from "#src/lib/subscription/types.ts";

function item(alias: string, channelId: string): SubscriptionListItem {
  return {
    subscriptionId: 1,
    channelId,
    player: {
      id: 2,
      alias,
      discordId: null,
      discordUser: null,
      accounts: [],
    },
    creatorDiscordId: "312300000000000001",
    creatorDiscordUser: null,
    createdTime: new Date(0),
    filters: null,
    isMuted: false,
  };
}

describe("/list", () => {
  test("keeps the read-only listing compact and links to full management", () => {
    const embed = buildListEmbed(
      Array.from({ length: MAX_LIST_ITEMS }, (_, index) =>
        item(
          `player-${index.toString()}`,
          `312300000000000${index.toString().padStart(3, "0")}`,
        ),
      ),
      true,
    );

    expect(embed.data.fields).toHaveLength(MAX_LIST_ITEMS);
    expect(embed.data.footer?.text).toContain("complete list");
    expect(embed.data.description).toContain("/app/");
  });
});

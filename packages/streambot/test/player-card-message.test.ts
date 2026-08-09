import { describe, expect, test } from "bun:test";
import { ButtonStyle, Client } from "discord.js";
import { PlayerCardMessenger } from "@shepherdjerred/streambot/discord/player-card-message.ts";
import { toMessagePayload } from "@shepherdjerred/streambot/discord/player-card-message.ts";
import type { PlayerCardPayload } from "@shepherdjerred/streambot/discord/player-card.ts";
import type { CardOwner } from "@shepherdjerred/streambot/discord/player-card-manager.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";

const OWNER: CardOwner = {
  guildId: GuildIdSchema.parse("200000000000000001"),
  voiceChannelId: ChannelIdSchema.parse("200000000000000002"),
};

function payload(over: Partial<PlayerCardPayload> = {}): PlayerCardPayload {
  return {
    content: "",
    embed: {
      title: "▶️ Heat (1995)",
      description: "the bar",
      imageUrl: null,
      thumbnailUrl: null,
    },
    rows: [
      [
        {
          id: "sb:v1:skip",
          label: "⏭ Skip",
          style: "primary",
          disabled: false,
        },
        { id: "sb:v1:stop", label: "⏹ Stop", style: "danger", disabled: true },
      ],
    ],
    select: null,
    ...over,
  };
}

describe("toMessagePayload", () => {
  test("maps the embed, button styles, labels, and disabled flags", () => {
    const options = toMessagePayload(payload());
    expect(options.content).toBe("");
    expect(options.embeds).toHaveLength(1);
    const embed = options.embeds[0]?.toJSON();
    expect(embed?.title).toBe("▶️ Heat (1995)");
    expect(embed?.description).toBe("the bar");

    expect(options.components).toHaveLength(1);
    const row = options.components[0]?.toJSON();
    expect(row?.components).toEqual([
      expect.objectContaining({
        custom_id: "sb:v1:skip",
        label: "⏭ Skip",
        style: ButtonStyle.Primary,
        disabled: false,
      }),
      expect.objectContaining({
        custom_id: "sb:v1:stop",
        label: "⏹ Stop",
        style: ButtonStyle.Danger,
        disabled: true,
      }),
    ]);
  });

  test("emits the poster as a thumbnail or a full image, per the payload", () => {
    const card = toMessagePayload(
      payload({
        embed: {
          title: "t",
          description: null,
          imageUrl: null,
          thumbnailUrl: "https://img/thumb.jpg",
        },
      }),
    );
    expect(card.embeds[0]?.toJSON().thumbnail?.url).toBe(
      "https://img/thumb.jpg",
    );

    const legacy = toMessagePayload(
      payload({
        embed: {
          title: "t",
          description: null,
          imageUrl: "https://img/big.jpg",
          thumbnailUrl: null,
        },
      }),
    );
    expect(legacy.embeds[0]?.toJSON().image?.url).toBe("https://img/big.jpg");
  });

  test("appends the chapter menu as its own row", () => {
    const options = toMessagePayload(
      payload({
        select: {
          id: "sb:v1:chapter",
          placeholder: "Jump to a chapter",
          options: [{ label: "1. Intro", value: "1", description: "0:00" }],
        },
      }),
    );
    expect(options.components).toHaveLength(2);
    const menu = options.components[1]?.toJSON().components[0];
    expect(menu).toEqual(
      expect.objectContaining({
        custom_id: "sb:v1:chapter",
        placeholder: "Jump to a chapter",
      }),
    );
  });

  test("drops empty rows rather than sending an invalid action row", () => {
    expect(toMessagePayload(payload({ rows: [[]] })).components).toEqual([]);
  });

  test("a control-less payload carries no components", () => {
    const options = toMessagePayload(payload({ rows: [], select: null }));
    expect(options.components).toEqual([]);
  });
});

describe("card routing table", () => {
  // `command-bot.ts` uses `ownerOf(...) !== null` to decide whether an incoming message is a player
  // card. That predicate is what stops N cards in one status channel from counting each other as
  // traffic and driving a self-sustaining delete/re-post loop.
  const messenger = new PlayerCardMessenger(new Client({ intents: [] }));

  test("an unregistered message id is not a card", () => {
    expect(messenger.ownerOf("999")).toBeNull();
  });

  test("registers, re-points, and unregisters a card", () => {
    messenger.register("card-1", OWNER);
    expect(messenger.ownerOf("card-1")).toEqual(OWNER);

    const moved: CardOwner = {
      guildId: OWNER.guildId,
      voiceChannelId: ChannelIdSchema.parse("200000000000000003"),
    };
    messenger.register("card-1", moved);
    expect(messenger.ownerOf("card-1")).toEqual(moved);

    messenger.unregister("card-1");
    expect(messenger.ownerOf("card-1")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  DiscordjsError,
  DiscordjsErrorCodes,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  selectedSportsEvent,
  sendSportsMenu,
  sportsMenuPage,
} from "@shepherdjerred/streambot/discord/sports-menu.ts";
import type { SportsEvent } from "@shepherdjerred/streambot/sports/types.ts";

const LIVE: SportsEvent = {
  id: "streameast:game",
  provider: "streameast",
  title: "Bears vs Packers",
  status: "live",
  startsAt: null,
  pageUrl: "https://v2.streameast.ga/game/",
};
const UNKNOWN: SportsEvent = {
  ...LIVE,
  id: "tvsportslive:game",
  provider: "tvsportslive",
  status: "unknown",
};
const UPCOMING: SportsEvent = {
  ...LIVE,
  id: "streameast:later",
  title: "Cubs vs Padres",
  status: "scheduled",
  startsAt: "2026-10-01T02:00:00.000Z",
};

function component(customId: string, value?: string) {
  return {
    customId,
    user: { id: "owner" },
    values: value === undefined ? [] : [value],
    isButton: () => customId !== "sports_pick",
    isStringSelectMenu: () => customId === "sports_pick",
    update: vi.fn().mockResolvedValue(null),
    deferUpdate: vi.fn().mockResolvedValue(null),
    reply: vi.fn().mockResolvedValue(null),
  };
}

function menuHarness() {
  const awaitMessageComponent = vi.fn();
  const editReply = vi.fn().mockResolvedValue(null);
  const interaction: ChatInputCommandInteraction = Object.assign(
    Object.create(ChatInputCommandInteraction.prototype),
    {
      user: { id: "owner" },
      editReply,
      fetchReply: async () => ({ awaitMessageComponent }),
    },
  );
  return { interaction, editReply, awaitMessageComponent };
}

describe("sports Discord picker", () => {
  it("renders readable status and provider fields, with only playable choices", () => {
    const payload = sportsMenuPage([LIVE, UNKNOWN, UPCOMING], 0);
    const embed = payload.embeds[0]!.toJSON();
    const row = payload.components[0]!.toJSON();
    expect(embed.title).toBe("Sports today");
    expect(embed.fields).toEqual([
      { name: LIVE.title, value: "🔴 **Live** · StreamEast" },
      { name: LIVE.title, value: "🟡 **Time unconfirmed** · TVSportsLive" },
      {
        name: UPCOMING.title,
        value: "🕒 **Upcoming** · <t:1790820000:t> · StreamEast",
      },
    ]);
    expect(row.components[0]).toMatchObject({
      custom_id: "sports_pick",
      options: [
        { label: LIVE.title, value: "0" },
        { label: LIVE.title, value: "1" },
      ],
    });
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it("paginates all entries, preserving the exact event behind short option values", () => {
    const events = Array.from({ length: 31 }, (_, index) => ({
      ...LIVE,
      id: String(index),
      title: `Game ${String(index)}`,
    }));
    const page = sportsMenuPage(events, 2);
    expect(page.embeds[0]!.toJSON().fields).toHaveLength(10);
    expect(page.embeds[0]!.toJSON().footer?.text).toContain(
      "Page 3 of 4 · 31 games",
    );
    expect(page.components[0]!.toJSON().components[0]).toMatchObject({
      options: [
        { value: "20" },
        ...Array.from({ length: 9 }, (_, i) => ({ value: String(i + 21) })),
      ],
    });
    expect(selectedSportsEvent(events, 2, "20")).toBe(events[20]);
    expect(selectedSportsEvent(events, 2, "0")).toBeNull();
  });

  it.each([undefined, "", "-1", "1.5", "url:https://example.com", "999", "2"])(
    "rejects invalid or upcoming selections (%s)",
    (value) => {
      expect(
        selectedSportsEvent([LIVE, UNKNOWN, UPCOMING], 0, value),
      ).toBeNull();
    },
  );

  it("keeps long provider titles within Discord limits and escapes markdown", () => {
    const page = sportsMenuPage(
      [{ ...LIVE, title: "**Game** ".repeat(100) }],
      0,
    );
    expect(
      page.embeds[0]!.toJSON().fields?.[0]?.name.length,
    ).toBeLessThanOrEqual(200);
    expect(page.embeds[0]!.toJSON().fields?.[0]?.name).toContain(
      String.raw`\*`,
    );
    const row = page.components[0]!.toJSON();
    expect(JSON.stringify(row)).not.toContain(LIVE.pageUrl);
    expect(row.components[0]).toMatchObject({
      options: [{ label: expect.stringMatching(/^.{100}$/), value: "0" }],
    });
  });

  it("renders empty and future-only listings without a play dropdown", () => {
    expect(sportsMenuPage([], 0).components).toEqual([]);
    expect(sportsMenuPage([UPCOMING], 0).components).toEqual([]);
    expect(sportsMenuPage([], 0).embeds[0]!.toJSON().description).toBe(
      "No sports streams are listed for today.",
    );
  });

  it("acknowledges a page change and queues only the selected page's exact event", async () => {
    const h = menuHarness();
    const next = component("sports_next");
    const pick = component("sports_pick", "10");
    const events = Array.from({ length: 11 }, (_, index) => ({
      ...LIVE,
      id: String(index),
    }));
    h.awaitMessageComponent
      .mockResolvedValueOnce(next)
      .mockResolvedValueOnce(pick);
    const play = vi.fn(async () => "Queued: Bears vs Packers");
    await sendSportsMenu(h.interaction, events, play);
    expect(next.update).toHaveBeenCalledOnce();
    expect(pick.deferUpdate).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledExactlyOnceWith(pick, events[10]);
    expect(h.editReply).toHaveBeenLastCalledWith({
      content: "Queued: Bears vs Packers",
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
    const filter = h.awaitMessageComponent.mock.calls[0]![0].filter;
    expect(
      filter({ user: { id: "another-user" }, customId: "sports_pick" }),
    ).toBe(false);
    expect(filter({ user: { id: "owner" }, customId: "unrelated" })).toBe(
      false,
    );
    expect(filter(pick)).toBe(true);
  });

  it("clears the checking state when playback fails and preserves the error", async () => {
    const h = menuHarness();
    const pick = component("sports_pick", "0");
    h.awaitMessageComponent.mockResolvedValue(pick);
    const error = new Error("Discord send failed");
    const play = vi.fn().mockRejectedValue(error);

    await expect(sendSportsMenu(h.interaction, [LIVE], play)).rejects.toBe(
      error,
    );
    expect(pick.deferUpdate).toHaveBeenCalledOnce();
    expect(h.editReply).toHaveBeenLastCalledWith({
      content: "Something went wrong starting that game. Please try again.",
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    });
  });

  it("removes expired controls without starting playback", async () => {
    const h = menuHarness();
    const expired = Object.assign(new Error("collector expired"), {
      code: DiscordjsErrorCodes.InteractionCollectorError,
    });
    Object.setPrototypeOf(expired, DiscordjsError.prototype);
    h.awaitMessageComponent.mockRejectedValue(expired);
    const play = vi.fn();
    await sendSportsMenu(h.interaction, [LIVE], play);
    expect(play).not.toHaveBeenCalled();
    expect(h.editReply).toHaveBeenLastCalledWith({
      content: expect.stringContaining("expired"),
      components: [],
    });
  });

  it("propagates Discord failures instead of presenting them as a timeout", async () => {
    const h = menuHarness();
    const error = new Error("Discord unavailable");
    h.awaitMessageComponent.mockRejectedValue(error);
    await expect(sendSportsMenu(h.interaction, [LIVE], vi.fn())).rejects.toBe(
      error,
    );
  });
});

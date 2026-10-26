import { expect, test, vi } from "vitest";
import { sportsListingEvents } from "./listing-text.ts";
import { lolSportsEvent } from "./lolesports.ts";
import {
  assertLolRequestEnabled,
  selectDirectRequestUrl,
  selectSportsForRequest,
} from "./playback-selection.ts";
import { voiceToolSchemas } from "@shepherdjerred/streambot/voice/voice-tool-types.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { lolMatch } from "#lol-fixture";

const scope = {
  guildId: GuildIdSchema.parse("100000000000000001"),
  channelId: ChannelIdSchema.parse("100000000000000002"),
  userId: UserIdSchema.parse("100000000000000003"),
};
function fixture() {
  const event = lolSportsEvent(lolMatch());
  const catalog = {
    listToday: vi.fn(async () => [
      { ...event, provider: "streameast" as const, title: "Lakers vs Bulls" },
    ]),
    listSchedule: vi.fn(async () => [event]),
    search: vi.fn(async () => ({ kind: "not-found" as const })),
  };
  return {
    event,
    catalog,
    scope,
    signal: AbortSignal.timeout(1000),
    enabled: async () => true,
    lolEnabled: async () => true,
  };
}

test.each([{ league: "worlds" }, { range: "week" as const }])(
  "Discord's auto provider honors LoL schedule filters (%s)",
  async (options) => {
    const f = fixture();
    expect(
      await sportsListingEvents({ ...f, provider: "auto", ...options }),
    ).toEqual([f.event]);
    expect(f.catalog.listSchedule).toHaveBeenCalledWith(f.signal, options);
    expect(f.catalog.listToday).not.toHaveBeenCalled();
  },
);
test("a generic voice team query uses today's sports while LoL is gated off", async () => {
  const f = fixture();
  const events = await sportsListingEvents({
    ...f,
    query: "Lakers",
    lolEnabled: async () => false,
  });
  expect(events[0]?.title).toBe("Lakers vs Bulls");
  expect(f.catalog.listToday).toHaveBeenCalledWith(f.signal, "auto");
  expect(f.catalog.listSchedule).not.toHaveBeenCalled();
});
test("an explicit non-LoL provider is retained even with LoL-shaped filters", async () => {
  const f = fixture();
  await sportsListingEvents({
    ...f,
    provider: "streameast",
    league: "worlds",
    range: "week",
  });
  expect(f.catalog.listToday).toHaveBeenCalledWith(f.signal, "streameast");
  expect(f.catalog.listSchedule).not.toHaveBeenCalled();
});
test.each([
  "Worlds",
  "league of legends worlds anthem",
  "Warriors league of legends",
])(
  "a disabled LoL catalog does not reject ordinary media: %s",
  async (query) => {
    const f = fixture();
    await expect(
      assertLolRequestEnabled({
        query,
        source: undefined,
        provider: undefined,
        scope,
        gate: async () => false,
      }),
    ).resolves.toBeUndefined();
    const resolve = vi.fn();
    const result = await selectSportsForRequest({
      ...f,
      query,
      source: "auto",
      provider: undefined,
      lolEnabled: async () => false,
      resolve,
      onAmbiguous: vi.fn(),
    });
    expect(result).toBeNull();
    expect(f.catalog.search).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  },
);
test("explicit LoL requests remain gated and pasted match URLs get a useful boundary message", async () => {
  const f = fixture();
  await expect(
    assertLolRequestEnabled({
      query: "",
      source: undefined,
      provider: "lolesports",
      scope,
      gate: async () => false,
    }),
  ).rejects.toThrow("not enabled");
  await expect(
    assertLolRequestEnabled({
      query: f.event.pageUrl,
      source: undefined,
      provider: undefined,
      scope,
      gate: async () => false,
    }),
  ).rejects.toThrow("not enabled");
  const resolve = vi.fn();
  await expect(
    selectDirectRequestUrl({
      ...f,
      query: f.event.pageUrl,
      spoken: false,
      source: "auto",
      resolve,
    }),
  ).rejects.toThrow("Choose this series from the LoL Esports schedule");
  expect(resolve).not.toHaveBeenCalled();
});
test("voice tools expose only supported league enum values", () => {
  expect(
    voiceToolSchemas.listSports.safeParse({ league: "worlds" }).success,
  ).toBe(true);
  expect(
    voiceToolSchemas.listSports.safeParse({ league: "Worlds" }).success,
  ).toBe(false);
  expect(voiceToolSchemas.listSports.safeParse({ league: "nba" }).success).toBe(
    false,
  );
});

import { RawMatchSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { timelineMatchesResult } from "#src/scout-client/canonical-match.ts";
import { lcuUuidsIn } from "#src/scout-client/identity-alias.ts";
import {
  aliasedLcuBundle as aliasedBundle,
  LcuBundleFixtureSchema as FixtureSchema,
  lcuBotBundle as botBundle,
  lcuBundleMatchId as matchIdOf,
  rawLcuFixture as rawFixture,
  withLcuTiming as withTiming,
} from "#src/testing/lcu-bundle-fixtures.ts";
import { convertLcuMatchBundle } from "./lcu-match.ts";
import { convertLcuTimeline } from "./lcu-timeline.ts";

const EndOfGameGoldSchema = z.looseObject({
  endOfGame: z.looseObject({
    teams: z.array(
      z.looseObject({
        players: z.array(
          z.looseObject({
            botPlayer: z.boolean(),
            championId: z.number(),
            stats: z.looseObject({ GOLD_EARNED: z.number() }),
          }),
        ),
      }),
    ),
  }),
});

describe("convertLcuMatchBundle", () => {
  test("converts a real ranked game with every participant", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await aliasedBundle("lcu-postgame-ranked"),
    );

    expect(match).not.toBeNull();
    expect(match?.metadata.dataVersion).toBe("local-1");
    expect(match?.info.queueId).toBe(420);
    expect(match?.info.participants).toHaveLength(10);
    expect(match?.metadata.participants).toHaveLength(10);
    expect(match?.info.teams.map((team) => team.win).toSorted()).toEqual([
      false,
      true,
    ]);
  });

  test.each([
    ["lcu-postgame-classic", 4310],
    ["lcu-postgame-aram-mayhem", 2400],
  ])("converts %s, which Riot's API never returns", async (name, queueId) => {
    const bundle = await aliasedBundle(name);
    const match = convertLcuMatchBundle(matchIdOf(bundle), bundle);

    expect(match?.info.queueId).toBe(queueId);
    expect(match?.info.participants).toHaveLength(10);
    expect(
      match?.info.participants.every(
        (participant) =>
          participant.participantKind === "player" &&
          participant.puuid?.length === 78,
      ),
    ).toBe(true);
    expect(match?.metadata.participants).toEqual(
      match?.info.participants.map((participant) => participant.puuid),
    );
    // The stored document must still satisfy its own contract.
    expect(RawMatchSchema.safeParse(match).success).toBe(true);
  });

  test("names champions by their Match-V5 key, not the display name", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await aliasedBundle("lcu-postgame-ranked"),
    );
    const wukong = match?.info.participants.find(
      (participant) => participant.championId === 62,
    );

    expect(wukong?.championName).toBe("MonkeyKing");
  });

  test("keeps the rune page and leaves the unreported stat shards absent", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await aliasedBundle("lcu-postgame-ranked"),
    );
    const perks = match?.info.participants[0]?.perks;

    expect(perks?.styles).toHaveLength(2);
    expect(perks?.styles[0]?.selections).toHaveLength(4);
    expect(perks?.statPerks).toBeUndefined();
  });

  test("states which team took the first Rift Herald", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await aliasedBundle("lcu-postgame-ranked"),
    );
    const firsts =
      match?.info.teams.filter((team) => team.objectives.riftHerald.first) ??
      [];

    expect(firsts.length).toBeLessThanOrEqual(1);
    for (const team of firsts) {
      expect(team.objectives.riftHerald.kills).toBeGreaterThan(0);
    }
  });

  test("keeps players with no alias yet unresolved, their UUID out of puuid", async () => {
    const raw = await rawFixture("lcu-postgame-classic");
    const bundle = withTiming(FixtureSchema.parse(raw));
    const match = convertLcuMatchBundle(matchIdOf(bundle), bundle);
    const uuids = [...lcuUuidsIn(raw)];

    expect(match?.info.participants).toHaveLength(10);
    expect(match?.metadata.participants).toEqual([]);
    for (const participant of match?.info.participants ?? []) {
      expect(participant.participantKind).toBe("unresolved");
      expect(participant.puuid).toBeNull();
      // Kept for a later alias to resolve on rebuild.
      expect(uuids).toContain(participant.leagueClientUuid);
    }
  });

  test("converts a bot game, pairing each bot by team and champion", async () => {
    const bots = [6, 7, 8, 9, 10];
    const bundle = await botBundle(bots);
    const match = convertLcuMatchBundle(matchIdOf(bundle), bundle);

    expect(match).not.toBeNull();
    expect(match?.metadata.participants).toHaveLength(5);
    for (const participant of match?.info.participants ?? []) {
      const bot = bots.includes(participant.participantId);
      expect(participant.participantKind).toBe(bot ? "bot" : "player");
      expect(participant.puuid === null).toBe(bot);
      expect(participant.leagueClientUuid).toBeUndefined();
    }
    // Each bot's statistics come from its own end-of-game row, not the first
    // bot's: every bot shares one UUID, so team and champion pair them.
    const goldByChampion = new Map(
      EndOfGameGoldSchema.parse(bundle)
        .endOfGame.teams.flatMap((team) => team.players)
        .filter((player) => player.botPlayer)
        .map((player) => [player.championId, player.stats.GOLD_EARNED]),
    );
    const botGold = (match?.info.participants ?? [])
      .filter((participant) => participant.participantKind === "bot")
      .map((participant) => [participant.championId, participant.goldEarned]);
    expect(botGold).toHaveLength(5);
    expect(new Map(botGold.map(([id, gold]) => [id, gold]))).toEqual(
      goldByChampion,
    );
  });

  test("refuses a bot game whose bots can't be told apart", async () => {
    // Two bots on one side with one champion: no source can single out either.
    const bundle = await botBundle([6, 7], 60_086);

    expect(convertLcuMatchBundle(matchIdOf(bundle), bundle)).toBeNull();
  });

  test("a converted bot timeline pairs with its match by participant and kind", async () => {
    const bundle = await botBundle([6, 7, 8, 9, 10]);
    const matchId = matchIdOf(bundle);
    const match = convertLcuMatchBundle(matchId, bundle);
    const timeline = convertLcuTimeline(
      matchId,
      bundle.matchHistory,
      bundle.timeline,
    );
    if (match === null || timeline === null) {
      throw new Error("Bot fixture must convert");
    }

    expect(timeline.metadata.participants).toEqual(match.metadata.participants);
    expect(timelineMatchesResult(timeline, match)).toBe(true);
    // A player in one artifact and a bot in the other is not the same person.
    const other = await botBundle([5, 7, 8, 9, 10]);
    const otherTimeline = convertLcuTimeline(
      matchId,
      other.matchHistory,
      other.timeline,
    );
    expect(otherTimeline).not.toBeNull();
    if (otherTimeline !== null) {
      expect(timelineMatchesResult(otherTimeline, match)).toBe(false);
    }
  });
});

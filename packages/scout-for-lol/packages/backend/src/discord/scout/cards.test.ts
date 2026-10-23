import { describe, expect, test } from "vitest";
import {
  ExploreMatchCardSchema,
  ExploreMessageSchema,
  type ExploreMessage,
} from "@scout-for-lol/data";
import {
  DISCORD_MAX_EMBEDS,
  exploreAnswerAttachments,
  embedCharacters,
  exploreCardEmbeds,
} from "#src/discord/scout/cards.ts";
import { scoutTestVisualization } from "#src/discord/scout/test-fixtures.ts";
import { testExploreLoadoutCard } from "#src/explore/loadout-card-test-fixture.ts";

function participant(id: number, champion: string, name: string) {
  return {
    participantId: id,
    riotId: { gameName: name, tagLine: "NA1" },
    championId: 100 + id,
    championName: champion,
    position: "MIDDLE",
    kills: id,
    deaths: 2,
    assists: 3,
    creepScore: 200,
    goldEarned: 12_000,
    visionScore: 20,
    damageToChampions: 20_000,
    killParticipation: 0.4,
    damageShare: 0.2,
    objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
  };
}

const MATCH_CARD = ExploreMatchCardSchema.parse({
  size: "S",
  match: {
    matchId: "NA1_5635906026",
    gameCreationMs: 1_788_627_280_000,
    gameDurationSeconds: 1728,
    queue: "Ranked Solo",
    queueId: 420,
    gameMode: "CLASSIC",
    gameType: "MATCHED_GAME",
    gameVersion: "16.17.1",
    mapId: 11,
    teams: [
      {
        teamId: 100,
        win: true,
        kills: 30,
        objectives: { turrets: 8, inhibitors: 1, barons: 1, dragons: 3 },
        participants: [participant(1, "Ahri", "Blue")],
      },
      {
        teamId: 200,
        win: false,
        kills: 20,
        objectives: { turrets: 3, inhibitors: 0, barons: 0, dragons: 1 },
        participants: [participant(6, "Yasuo", "Red")],
      },
    ],
  },
});

function answer(overrides: Partial<ExploreMessage> = {}): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    role: "assistant",
    content: "Here is the game.",
    createdAt: "2026-10-21T00:00:00.000Z",
    ...overrides,
  });
}

describe("exploreCardEmbeds", () => {
  test("renders a match card with both teams and a link to the match", () => {
    const [embed] = exploreCardEmbeds(answer({ matchCards: [MATCH_CARD] }), {
      embeds: 0,
      characters: 0,
    });
    const json = embed?.toJSON();
    expect(json?.title).toBe("Ranked Solo · 28:48");
    expect(json?.url).toContain("/app/explore/matches/NA1_5635906026");
    expect(json?.fields?.map((field) => field.name)).toEqual([
      "Victory — 30 kills",
      "Defeat — 20 kills",
    ]);
    expect(json?.fields?.[0]?.value).toBe("Ahri · Blue · 1/2/3");
  });

  test("renders a loadout card with items, spells and runes", () => {
    const [embed] = exploreCardEmbeds(
      answer({ loadoutCards: [testExploreLoadoutCard("S")] }),
      { embeds: 0, characters: 0 },
    );
    const names = embed?.toJSON().fields?.map((field) => field.name);
    expect(names).toEqual(["Final items", "Spells", "Runes"]);
  });

  test("never exceeds Discord's embed ceiling", () => {
    const embeds = exploreCardEmbeds(
      answer({
        matchCards: [MATCH_CARD],
        loadoutCards: [testExploreLoadoutCard("S")],
      }),
      { embeds: DISCORD_MAX_EMBEDS - 1, characters: 0 },
    );
    expect(embeds).toHaveLength(1);
  });

  test("never exceeds Discord's combined embed text", () => {
    const cards = answer({
      matchCards: [MATCH_CARD],
      loadoutCards: [testExploreLoadoutCard("S")],
    });
    const [first] = exploreCardEmbeds(cards, { embeds: 0, characters: 0 });
    if (first === undefined) throw new Error("Expected a card");
    const firstSize = embedCharacters(first.toJSON());
    // Room for exactly one card after what the visualization used.
    const embeds = exploreCardEmbeds(cards, {
      embeds: 1,
      characters: 6000 - firstSize,
    });
    expect(embeds).toHaveLength(1);
    expect(
      exploreCardEmbeds(cards, { embeds: 1, characters: 6000 }),
    ).toHaveLength(0);
  });

  test("a card too long for the budget does not hide a shorter one after it", () => {
    const cards = answer({
      matchCards: [MATCH_CARD],
      loadoutCards: [testExploreLoadoutCard("S")],
    });
    const [match, loadout] = exploreCardEmbeds(cards, {
      embeds: 0,
      characters: 0,
    });
    if (match === undefined || loadout === undefined)
      throw new Error("Expected both cards");
    const loadoutSize = embedCharacters(loadout.toJSON());
    expect(loadoutSize).toBeLessThan(embedCharacters(match.toJSON()));
    const kept = exploreCardEmbeds(cards, {
      embeds: 1,
      characters: 6000 - loadoutSize,
    });
    expect(kept.map((embed) => embed.toJSON().fields?.[0]?.name)).toEqual([
      "Final items",
    ]);
  });
});

describe("exploreAnswerAttachments", () => {
  test("puts the visualization first, then the cards", () => {
    const payload = exploreAnswerAttachments(
      answer({
        matchCards: [MATCH_CARD],
        visualization: scoutTestVisualization,
      }),
    );
    const titles = (payload.embeds ?? []).map((embed) => embed.toJSON().title);
    expect(titles.at(-1)).toBe("Ranked Solo · 28:48");
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  test("an answer with no cards and no visualization attaches nothing", () => {
    expect(exploreAnswerAttachments(answer())).toEqual({});
  });
});

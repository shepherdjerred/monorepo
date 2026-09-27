import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExploreLoadoutCardSchema } from "@scout-for-lol/data";
import { ExploreLoadoutCards } from "#src/components/explore/explore-loadout-cards.tsx";

function card(size: "S" | "L" = "L") {
  return ExploreLoadoutCardSchema.parse({
    size,
    matchId: "NA1_5635906026",
    participantId: 1,
    championId: 103,
    championName: "Ahri",
    gameDurationSeconds: 1728,
    finalItems: [
      { slot: 0, itemId: 1001, name: "Boots" },
      { slot: 1, itemId: null, name: null },
      { slot: 2, itemId: null, name: null },
      { slot: 3, itemId: null, name: null },
      { slot: 4, itemId: null, name: null },
      { slot: 5, itemId: null, name: null },
      { slot: 6, itemId: 3363, name: "Farsight Alteration" },
    ],
    spells: [
      { slot: 1, spellId: "SummonerFlash", name: "Flash" },
      { slot: 2, spellId: null, name: null },
    ],
    runePage: {
      primaryTree: { id: 8000, assetKey: "7201_Precision", name: "Precision" }, // gitleaks:allow — Riot rune asset identifier.
      keystone: { id: 8010, assetKey: "Conqueror", name: "Conqueror" },
      primaryRunes: [],
      secondaryTree: null,
      secondaryRunes: [],
      shards: [
        { slot: "offense", id: 5008 },
        { slot: "flex", id: 5008 },
        { slot: "defense", id: 5011 },
      ],
    },
    buildPathRecorded: true,
    buildPathTruncated: false,
    buildPath: [
      { minute: 1, itemId: 1001, name: "Boots", kind: "purchase" },
      { minute: 3, itemId: 2003, name: "Health Potion", kind: "sold" },
    ],
    skillOrder: [
      { level: 1, skill: "Q" },
      { level: 2, skill: "W" },
    ],
  });
}

describe("ExploreLoadoutCards", () => {
  test("renders final items, rune page, path events and skill order", () => {
    const markup = renderToStaticMarkup(
      <ExploreLoadoutCards cards={[card()]} />,
    );
    expect(markup).toContain("Ahri loadout");
    expect(markup).toContain("Final build");
    expect(markup).toContain("Trinket: Farsight Alteration");
    expect(markup).toContain("Conqueror");
    expect(markup).toContain("offense: 5008");
    expect(markup).toContain("1m");
    expect(markup).toContain("Sold");
    expect(markup).toContain("Level 1: Q");
  });

  test("explains when timeline data was not recorded", () => {
    const missingTimeline = ExploreLoadoutCardSchema.parse({
      ...card(),
      buildPathRecorded: false,
      buildPath: [],
      skillOrder: [],
    });
    const markup = renderToStaticMarkup(
      <ExploreLoadoutCards cards={[missingTimeline]} />,
    );
    expect(markup).toContain("Timeline data is not recorded for this match");
    expect(markup).toContain("Skill order is not recorded");
  });

  test("renders compact cards without the detailed sections", () => {
    const compact = card("S");
    const markup = renderToStaticMarkup(
      <ExploreLoadoutCards cards={[compact]} />,
    );
    expect(markup).toContain("Final build");
    expect(markup).toContain("Summoner spells");
    expect(markup).not.toContain("Rune page");
    expect(markup).not.toContain("Build path");
    expect(markup).not.toContain("Skill order");
  });

  test("labels unknown item IDs instead of rendering them as empty slots", () => {
    const unknownItem = ExploreLoadoutCardSchema.parse({
      ...card(),
      finalItems: [
        { slot: 0, itemId: 999_999, name: null },
        ...card().finalItems.slice(1),
      ],
    });
    const markup = renderToStaticMarkup(
      <ExploreLoadoutCards cards={[unknownItem]} />,
    );
    expect(markup).toContain("Unknown item ID 999999");
    expect(markup).toContain("ID 999999");
  });

  test("explains when an older card omits the build path truncation field", () => {
    const olderCard: Record<string, unknown> = { ...card() };
    delete olderCard["buildPathTruncated"];
    const parsed = ExploreLoadoutCardSchema.parse(olderCard);
    expect(parsed.buildPathTruncated).toBe(false);
  });

  test("explains when earlier build path events were omitted", () => {
    const truncated = ExploreLoadoutCardSchema.parse({
      ...card(),
      buildPathTruncated: true,
    });
    const markup = renderToStaticMarkup(
      <ExploreLoadoutCards cards={[truncated]} />,
    );
    expect(markup).toContain("Showing the most recent 100 events");
    expect(markup).toContain("earlier item events are omitted");
  });

  test("omits the artifact region when no cards are selected", () => {
    expect(renderToStaticMarkup(<ExploreLoadoutCards cards={[]} />)).toBe("");
  });
});

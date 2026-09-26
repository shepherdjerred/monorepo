import {
  ExploreLoadoutCardSchema,
  type ExploreLoadoutCard,
} from "@scout-for-lol/data";

export function testExploreLoadoutCard(size: "S" | "L"): ExploreLoadoutCard {
  return ExploreLoadoutCardSchema.parse({
    size,
    matchId: "NA1_5635906026",
    participantId: 1,
    championId: 103,
    championName: "Ahri",
    gameDurationSeconds: 1728,
    finalItems: Array.from({ length: 7 }, (_, slot) => ({
      slot,
      itemId: slot === 0 ? 1001 : null,
      name: slot === 0 ? "Boots" : null,
    })),
    spells: [
      { slot: 1, spellId: "SummonerFlash", name: "Flash" },
      { slot: 2, spellId: "SummonerDot", name: "Ignite" },
    ],
    runePage: {
      primaryTree: null,
      keystone: null,
      primaryRunes: [],
      secondaryTree: null,
      secondaryRunes: [],
      shards: [
        { slot: "offense", id: null },
        { slot: "flex", id: null },
        { slot: "defense", id: null },
      ],
    },
    buildPathRecorded: false,
    buildPath: [],
    skillOrder: [],
  });
}

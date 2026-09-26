import { describe, expect, test } from "vitest";
import {
  ExploreLoadoutCardRequestSchema,
  ReportAiPreviewSummarySchema,
} from "@scout-for-lol/data";
import {
  buildExploreLoadoutCard,
  buildPathFromEvents,
  loadoutPairsInPreview,
  skillOrderFromEvents,
} from "#src/explore-match/loadout-view.ts";
import type { LakeMatchLoadoutRow } from "#src/reports/duckdb/consumer-match-loadout-lake-reads.ts";

const PUUID = "0192af5b-0c88-7c3a-a17f-858c0a170001";
const LOADOUT_ROW: LakeMatchLoadoutRow = {
  match_id: "NA1_12345",
  game_duration_seconds: 1800,
  puuid: PUUID,
  participant_id: 1,
  champion_id: 103,
  champion_name: "Ahri",
  item0: 1056,
  item1: 3020,
  item2: 3089,
  item3: 3135,
  item4: 3165,
  item5: 3157,
  item6: 3363,
  summoner1_id: 4,
  summoner2_id: 14,
  perk_primary_style: 8100,
  perk_sub_style: 8200,
  perk0: 8112,
  perk1: 8126,
  perk2: 8139,
  perk3: 8143,
  perk4: 8224,
  perk5: 8236,
  stat_perk_offense: 5008,
  stat_perk_flex: 5008,
  stat_perk_defense: 5011,
};

function event(input: {
  id: string;
  timestamp: number;
  type: string;
  itemId?: number | null;
  beforeId?: number | null;
  skillSlot?: number | null;
  level?: number | null;
}) {
  return {
    event_id: input.id,
    event_timestamp_ms: input.timestamp,
    frame_index: Math.floor(input.timestamp / 60_000),
    event_index: input.timestamp,
    event_type: input.type,
    item_id: input.itemId ?? null,
    before_id: input.beforeId ?? null,
    skill_slot: input.skillSlot ?? null,
    level: input.level ?? null,
  };
}

describe("Explore loadout card eligibility", () => {
  test("accepts only exact match and PUUID pairs from participant rows", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [
        { key: "label", label: "Label", format: "text" },
        { key: "match_id", label: "Match Id", format: "text" },
        { key: "puuid", label: "Puuid", format: "text" },
      ],
      rows: [
        {
          label: "NA1_123",
          values: [
            { column: "match_id", value: "NA1_123" },
            { column: "puuid", value: PUUID },
          ],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 1,
      renderKind: "TABLE",
    });
    expect(loadoutPairsInPreview(preview, "match_participants")).toEqual(
      new Set([JSON.stringify(["NA1_123", PUUID])]),
    );
    expect(loadoutPairsInPreview(preview, "match_teams")).toEqual(new Set());
  });

  test("requires both identity columns in the latest result", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [{ key: "match_id", label: "Match Id", format: "text" }],
      rows: [
        {
          label: "NA1_123",
          values: [{ column: "match_id", value: "NA1_123" }],
        },
      ],
      visualizationRows: [],
      rowsReturned: 1,
      rowsScanned: 1,
      renderKind: "TABLE",
    });
    expect(loadoutPairsInPreview(preview, "match_participants")).toEqual(
      new Set(),
    );
  });
});

describe("loadout timeline reconstruction", () => {
  test("removes undone purchases, marks sales, and keeps the minute order", () => {
    expect(
      buildPathFromEvents([
        event({
          id: "buy-boots",
          timestamp: 61_000,
          type: "ITEM_PURCHASED",
          itemId: 1001,
        }),
        event({
          id: "undo-boots",
          timestamp: 62_000,
          type: "ITEM_UNDO",
          beforeId: 1001,
        }),
        event({
          id: "buy-ring",
          timestamp: 245_000,
          type: "ITEM_PURCHASED",
          itemId: 1056,
        }),
        event({
          id: "sell-ring",
          timestamp: 980_000,
          type: "ITEM_SOLD",
          itemId: 1056,
        }),
      ]),
    ).toEqual([
      { minute: 4, itemId: 1056, name: "Doran's Ring", kind: "purchase" },
      { minute: 16, itemId: 1056, name: "Doran's Ring", kind: "sold" },
    ]);
  });

  test("orders skills by champion level and translates Riot's slots", () => {
    expect(
      skillOrderFromEvents([
        event({
          id: "level-2",
          timestamp: 120_000,
          type: "SKILL_LEVEL_UP",
          skillSlot: 2,
          level: 2,
        }),
        event({
          id: "level-1",
          timestamp: 60_000,
          type: "SKILL_LEVEL_UP",
          skillSlot: 1,
          level: 1,
        }),
        event({
          id: "ultimate",
          timestamp: 360_000,
          type: "SKILL_LEVEL_UP",
          skillSlot: 4,
          level: 6,
        }),
      ]),
    ).toEqual([
      { level: 1, skill: "Q" },
      { level: 2, skill: "W" },
      { level: 6, skill: "R" },
    ]);
  });
});

describe("Explore loadout card hydration", () => {
  test("maps participant fields and asset filenames without retaining the PUUID", () => {
    const card = buildExploreLoadoutCard({
      request: ExploreLoadoutCardRequestSchema.parse({
        matchId: "NA1_12345",
        puuid: PUUID,
        size: "L",
      }),
      row: LOADOUT_ROW,
      timelineEvents: null,
    });

    expect(card).toMatchObject({
      matchId: "NA1_12345",
      championName: "Ahri",
      finalItems: [
        { slot: 0, itemId: 1056, name: "Doran's Ring" },
        { slot: 1, itemId: 3020, name: "Sorcerer's Shoes" },
        { slot: 2, itemId: 3089, name: "Rabadon's Deathcap" },
        { slot: 3, itemId: 3135, name: "Void Staff" },
        { slot: 4, itemId: 3165, name: "Morellonomicon" },
        { slot: 5, itemId: 3157, name: "Zhonya's Hourglass" },
        { slot: 6, itemId: 3363, name: "Farsight Alteration" },
      ],
      spells: [
        { slot: 1, spellId: "SummonerFlash", name: "Flash" },
        { slot: 2, spellId: "SummonerDot", name: "Ignite" },
      ],
      runePage: {
        primaryTree: { assetKey: "7200_Domination", name: "Domination" },
        keystone: { assetKey: "Electrocute", name: "Electrocute" },
        secondaryTree: { assetKey: "7202_Sorcery", name: "Sorcery" },
        secondaryRunes: [
          { id: 8224, assetKey: "Axiom_Arcanist", name: "Axiom Arcanist" },
          { id: 8236, assetKey: "GatheringStorm", name: "Gathering Storm" },
        ],
        shards: [
          { slot: "offense", id: 5008 },
          { slot: "flex", id: 5008 },
          { slot: "defense", id: 5011 },
        ],
      },
      buildPathRecorded: false,
      buildPath: [],
      skillOrder: [],
    });
    expect(card).not.toHaveProperty("puuid");
  });
});

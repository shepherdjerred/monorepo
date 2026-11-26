import { describe, expect, test } from "vitest";
import {
  GeneralTipFileSchema,
  GeneralTipSetSchema,
  GlossaryEntrySchema,
  GlossaryFileSchema,
  MatchupTipFileSchema,
  MatchupTipSetSchema,
  generalTipFilePath,
  matchupTipFilePath,
} from "#src/tips/schema.ts";
import {
  AHRI,
  CHARMED,
  ahriMidGeneralSet,
  ahriSyndraMidSets,
} from "#src/tips/tips.fixture.ts";

const HASH = "a".repeat(64);

/** Through JSON text, as the generator writes and the loader reads. */
function roundTrip(value: unknown): unknown {
  const text = JSON.stringify(value);
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

describe("tip schemas", () => {
  test("tip sets, files and glossary entries round-trip through JSON", () => {
    const { forward, reverse } = ahriSyndraMidSets(HASH);
    const general = ahriMidGeneralSet(HASH);
    expect(MatchupTipSetSchema.parse(roundTrip(forward))).toEqual(forward);
    expect(GeneralTipSetSchema.parse(roundTrip(general))).toEqual(general);
    expect(GlossaryEntrySchema.parse(roundTrip(CHARMED))).toEqual(CHARMED);

    const matchupFile = {
      schemaVersion: 1,
      lane: "middle",
      champion: AHRI,
      sets: [forward],
    };
    expect(MatchupTipFileSchema.parse(roundTrip(matchupFile))).toEqual(
      matchupFile,
    );
    const generalFile = { schemaVersion: 1, lane: "middle", sets: [general] };
    expect(GeneralTipFileSchema.parse(roundTrip(generalFile))).toEqual(
      generalFile,
    );
    expect(
      GlossaryFileSchema.parse(
        roundTrip({ schemaVersion: 1, entries: [CHARMED] }),
      ).entries,
    ).toEqual([CHARMED]);
    expect(reverse.champion).not.toBe(forward.champion);
  });

  test("rejects tips over 160 characters and tip counts out of range", () => {
    const { forward } = ahriSyndraMidSets(HASH);
    const longTip = { text: "x".repeat(161), cites: [] };
    expect(
      MatchupTipSetSchema.safeParse({ ...forward, tips: [longTip] }).success,
    ).toBe(false);
    expect(
      MatchupTipSetSchema.safeParse({ ...forward, tips: [] }).success,
    ).toBe(false);
    const fourTips = [...forward.tips, ...forward.tips.slice(0, 1)];
    expect(
      MatchupTipSetSchema.safeParse({ ...forward, tips: fourTips }).success,
    ).toBe(false);
    const general = ahriMidGeneralSet(HASH);
    expect(
      GeneralTipSetSchema.safeParse({
        ...general,
        tips: general.tips.slice(0, 2),
      }).success,
    ).toBe(false);
  });

  test("rejects mirror matchups, bad hashes, unknown cite kinds and long definitions", () => {
    const { forward } = ahriSyndraMidSets(HASH);
    expect(
      MatchupTipSetSchema.safeParse({ ...forward, opponent: AHRI }).success,
    ).toBe(false);
    expect(
      MatchupTipSetSchema.safeParse({ ...forward, inputHash: "abc" }).success,
    ).toBe(false);
    expect(
      MatchupTipSetSchema.safeParse({
        ...forward,
        tips: [{ text: "Push.", cites: [{ kind: "winRate", value: 0.5 }] }],
      }).success,
    ).toBe(false);
    expect(
      GlossaryEntrySchema.safeParse({ ...CHARMED, definition: "x".repeat(201) })
        .success,
    ).toBe(false);
  });

  test("files reject sets that disagree with the file or repeat", () => {
    const { forward, reverse } = ahriSyndraMidSets(HASH);
    expect(
      MatchupTipFileSchema.safeParse({
        schemaVersion: 1,
        lane: "middle",
        champion: AHRI,
        sets: [forward, reverse],
      }).success,
    ).toBe(false);
    expect(
      MatchupTipFileSchema.safeParse({
        schemaVersion: 1,
        lane: "middle",
        champion: AHRI,
        sets: [forward, forward],
      }).success,
    ).toBe(false);
    const general = ahriMidGeneralSet(HASH);
    expect(
      GeneralTipFileSchema.safeParse({
        schemaVersion: 1,
        lane: "top",
        sets: [general],
      }).success,
    ).toBe(false);
    expect(
      GlossaryFileSchema.safeParse({
        schemaVersion: 1,
        entries: [CHARMED, CHARMED],
      }).success,
    ).toBe(false);
  });

  test("file paths follow the generated layout", () => {
    expect(matchupTipFilePath("middle", "MonkeyKing")).toBe(
      "matchup/middle/MonkeyKing.json",
    );
    expect(generalTipFilePath("support")).toBe("general/support.json");
  });
});

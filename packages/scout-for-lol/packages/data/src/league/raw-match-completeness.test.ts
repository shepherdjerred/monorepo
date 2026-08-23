import { describe, expect, test } from "vitest";
import {
  RawMatchSchema,
  isCustomMatchPayload,
  missingExpectedMatchFields,
} from "#src/league/raw-match.schema.ts";
import {
  omitFields,
  toCustomLobby,
} from "#src/testing/custom-match-fixture.ts";

const RIFT_PATH = `${import.meta.dir}/../../../../testdata/rift.json`;

const ALL_EXPECTED = [
  "info.endOfGameResult",
  "info.tournamentCode",
  "info.participants[].eligibleForProgression",
  "info.participants[].missions",
  "info.participants[].summonerId",
  "info.participants[].summonerName",
];

async function riftMatch() {
  const raw: unknown = JSON.parse(await Bun.file(RIFT_PATH).text());
  return RawMatchSchema.parse(raw);
}

describe("isCustomMatchPayload", () => {
  test("is false for a matchmade game", async () => {
    const rift = await riftMatch();
    expect(rift.info.gameType).toBe("MATCHED_GAME");
    expect(isCustomMatchPayload(rift)).toBe(false);
  });

  test("is true for CUSTOM_GAME", async () => {
    const custom = toCustomLobby(await riftMatch(), 3, 3);
    expect(isCustomMatchPayload(custom)).toBe(true);
  });
});

describe("missingExpectedMatchFields", () => {
  test("reports nothing for a complete matchmade payload", async () => {
    const rift = await riftMatch();
    expect(missingExpectedMatchFields(rift)).toEqual([]);
  });

  test("reports every absent field by dotted path", async () => {
    const stripped = omitFields(await riftMatch(), ALL_EXPECTED);
    expect(missingExpectedMatchFields(stripped)).toEqual(ALL_EXPECTED);
  });

  test("reports a participant field once, not once per participant", async () => {
    const stripped = omitFields(await riftMatch(), [
      "info.participants[].summonerId",
    ]);
    expect(missingExpectedMatchFields(stripped)).toEqual([
      "info.participants[].summonerId",
    ]);
  });

  test("reports a field absent from only one participant", async () => {
    const rift = await riftMatch();
    const [first, ...rest] = rift.info.participants;
    if (first === undefined) throw new Error("no participants in fixture");
    const { summonerId: _dropped, ...withoutId } = first;
    const partial = RawMatchSchema.parse({
      ...rift,
      info: { ...rift.info, participants: [withoutId, ...rest] },
    });

    expect(missingExpectedMatchFields(partial)).toEqual([
      "info.participants[].summonerId",
    ]);
  });

  test("the stripped payload still parses — that is what makes the check necessary", async () => {
    const stripped = omitFields(await riftMatch(), ALL_EXPECTED);
    // If the schema rejected this, custom games would never reach the check at
    // all; if the check passed it, matchmade games would silently degrade.
    expect(RawMatchSchema.safeParse(stripped).success).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema, RawMatchSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { parseLocalCanonicalMatch } from "./canonical-match.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const riotMatchId = RiotMatchIdSchema.parse(fixture.metadata.matchId);
const observer = LeaguePuuidSchema.parse(fixture.metadata.participants[0]);

function candidate(payload: unknown, platformId = fixture.info.platformId) {
  return {
    observationId: "00000000-0000-4000-8000-000000000001",
    platformId,
    localPuuid: observer,
    payload,
    bodyDigest: "a".repeat(64),
  };
}

describe("parseLocalCanonicalMatch", () => {
  test("accepts a complete wrapped payload with matching identities", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture })),
    ).toEqual(fixture);
  });

  test("derives metadata around a complete LCU match info payload", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate({ data: fixture.info })),
    ).toEqual(fixture);
  });

  test("does not promote partial LCU evidence by inventing missing fields", () => {
    expect(
      parseLocalCanonicalMatch(
        riotMatchId,
        candidate({
          data: {
            gameId: fixture.info.gameId,
            platformId: fixture.info.platformId,
            participants: [],
          },
        }),
      ),
    ).toBeNull();
  });

  test("rejects a payload attributed to another platform", () => {
    expect(
      parseLocalCanonicalMatch(riotMatchId, candidate(fixture, "EUW1")),
    ).toBeNull();
  });
});

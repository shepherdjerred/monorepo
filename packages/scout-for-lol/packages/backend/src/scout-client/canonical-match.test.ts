import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema, RawMatchSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { parseLocalCanonicalMatch } from "./canonical-match.ts";

const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);
const riotMatchId = RiotMatchIdSchema.parse(fixture.metadata.matchId);
const observer = LeaguePuuidSchema.parse(fixture.metadata.participants[0]);

function candidate(
  payload: unknown,
  platformId = fixture.info.platformId,
  localPuuid = observer,
) {
  return {
    observationId: "00000000-0000-4000-8000-000000000001",
    platformId,
    localPuuid,
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

  test("converts a legacy LCU match-history row to canonical Match-V5", async () => {
    const payload = await Bun.file(
      "../../testdata/lcu-match-history-game.json",
    ).json();
    const localMatchId = RiotMatchIdSchema.parse("NA1_9876543210");
    const localPuuid = LeaguePuuidSchema.parse("p".repeat(78));

    const match = parseLocalCanonicalMatch(
      localMatchId,
      candidate({ data: payload }, "NA1", localPuuid),
    );

    expect(match).not.toBeNull();
    expect(match?.info.gameStartTimestamp).toBe(1_780_000_000_000);
    expect(match?.info.gameEndTimestamp).toBe(1_780_001_451_000);
    expect(match?.info.participants[0]).toMatchObject({
      puuid: localPuuid,
      kills: 5,
      deaths: 2,
      assists: 7,
      summoner1Id: 4,
      summoner2Id: 14,
      teamPosition: "MIDDLE",
    });
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

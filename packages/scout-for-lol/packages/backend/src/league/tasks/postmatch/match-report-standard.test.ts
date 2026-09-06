import { describe, expect, test } from "vitest";
import {
  MatchIdSchema,
  PlayerConfigEntrySchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import {
  fetchTimelineForDuelProgression,
  fetchTimelineForProgression,
  fetchTimelineIfStandardMatch,
} from "./match-report-standard.ts";

const fixtureUrl = new URL(
  "../../../../../../testdata/rift.json",
  import.meta.url,
);

async function arenaFixture() {
  const input: unknown = await Bun.file(fixtureUrl).json();
  const match = RawMatchSchema.parse(input);
  const participant = match.info.participants[0];
  if (participant === undefined) {
    throw new Error("Timeline fixture requires a participant");
  }
  return {
    match: RawMatchSchema.parse({
      ...match,
      info: { ...match.info, queueId: 1700, gameMode: "CHERRY" },
    }),
    players: [
      PlayerConfigEntrySchema.parse({
        alias: "Arena timeline player",
        league: {
          leagueAccount: {
            puuid: participant.puuid,
            region: "AMERICA_NORTH",
          },
        },
      }),
    ],
  };
}

describe("required progression timelines", () => {
  test("rejects an unsupported Arena timeline before progression advances", async () => {
    const fixture = await arenaFixture();
    const matchId = MatchIdSchema.parse(fixture.match.metadata.matchId);

    await expect(
      fetchTimelineForProgression(fixture.match, matchId, fixture.players),
    ).rejects.toThrow("match processing must retry");
    await expect(
      fetchTimelineIfStandardMatch(fixture.match, matchId, fixture.players),
    ).resolves.toBeUndefined();
    await expect(
      fetchTimelineForDuelProgression(fixture.match, matchId, fixture.players),
    ).resolves.toBeUndefined();
  });
});

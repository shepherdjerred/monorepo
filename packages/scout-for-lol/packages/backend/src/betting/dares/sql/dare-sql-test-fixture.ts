import {
  RawMatchSchema,
  RawTimelineSchema,
  type DareTargetBinding,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";

export async function loadDareSqlMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../../../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  const match = RawMatchSchema.parse(json);
  return RawMatchSchema.parse({
    ...match,
    info: { ...match.info, queueId: 420, gameMode: "CLASSIC" },
  });
}

export function dareSqlTargetForMatch(match: RawMatch): DareTargetBinding {
  const participant = match.info.participants[0];
  if (participant === undefined) throw new Error("fixture participant missing");
  return {
    key: "T1",
    discordId: "100000000000000001",
    playerId: 1,
    alias: "Target",
    accounts: [
      {
        puuid: participant.puuid,
        trackingStartedAt: new Date(
          match.info.gameStartTimestamp - 1000,
        ).toISOString(),
      },
    ],
  };
}

export function dareSqlTimelineForMatch(
  match: RawMatch,
  frames: RawTimeline["info"]["frames"],
): RawTimeline {
  return RawTimelineSchema.parse({
    metadata: {
      dataVersion: "2",
      matchId: match.metadata.matchId,
      participants: match.info.participants.map((row) => row.puuid),
    },
    info: {
      frameInterval: 60_000,
      gameId: match.info.gameId,
      participants: match.info.participants.map((row) => ({
        participantId: row.participantId,
        puuid: row.puuid,
      })),
      frames,
    },
  });
}

import { describe, expect, test } from "vitest";
import {
  CanonicalMatchRecordSchema,
  HISTORY_UNSTATED_PARTICIPANT_FIELDS,
  HistoryParticipantSchema,
  RawParticipantSchema,
  SCOUT_CLIENT_HISTORY_DATA_VERSION,
  matchCoverageOf,
  matchDataSourceOf,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { convertHistoryMatch } from "./history-match.ts";

const GameSchema = z.looseObject({
  gameId: z.number(),
  gameCreation: z.number(),
  gameDuration: z.number(),
  queueId: z.number(),
  participants: z.array(
    z.looseObject({ participantId: z.number(), teamId: z.number() }),
  ),
  participantIdentities: z.array(
    z.looseObject({
      participantId: z.number(),
      player: z.looseObject({ puuid: z.string() }),
    }),
  ),
});

async function fixture(name: string): Promise<unknown> {
  return await Bun.file(
    new URL(`../../../../../testdata/lcu/${name}.json`, import.meta.url),
  ).json();
}

const game = GameSchema.parse(await fixture("lcu-game-aram-mayhem"));
const timeline = await fixture("lcu-timeline-aram-mayhem");
const matchId = RiotMatchIdSchema.parse(`NA1_${game.gameId.toString()}`);
const observer = "o".repeat(78);

/** The fixture with its first player resolved to a Riot PUUID, as aliases leave it. */
function resolvedGame(): Record<string, unknown> {
  return {
    ...game,
    participantIdentities: game.participantIdentities.map((identity, index) =>
      index === 0
        ? { ...identity, player: { ...identity.player, puuid: observer } }
        : identity,
    ),
  };
}

describe("convertHistoryMatch", () => {
  test("records an unwitnessed ARAM Mayhem game from its history row and timeline", () => {
    const match = convertHistoryMatch(matchId, {
      matchHistory: resolvedGame(),
      timeline,
    });
    expect(match).not.toBeNull();
    if (match === null) return;
    expect(match.metadata.dataVersion).toBe(SCOUT_CLIENT_HISTORY_DATA_VERSION);
    expect(matchCoverageOf(match.metadata)).toBe("history");
    expect(matchDataSourceOf(match.metadata)).toBe("SCOUT_CLIENT");
    // Only resolved players are listed; unaliased players stay unresolved.
    expect(match.metadata.participants).toEqual([observer]);
    expect(match.info.queueId).toBe(2400);
    expect(match.info.participants).toHaveLength(10);
    expect(match.info.teams).toHaveLength(2);
    expect(match.info.gameStartTimestamp).toBe(game.gameCreation);
    expect(match.info.gameEndTimestamp).toBe(
      game.gameCreation + game.gameDuration * 1000,
    );
    const [first] = match.info.participants;
    expect(first?.puuid).toBe(observer);
    expect(first?.kills).toBe(11);
    // Unstated is null, never zero.
    for (const participant of match.info.participants) {
      for (const field of HISTORY_UNSTATED_PARTICIPANT_FIELDS) {
        expect(participant[field], field).toBeNull();
      }
    }
    // The archived document reads back as a history record.
    expect(
      CanonicalMatchRecordSchema.parse(structuredClone(match)).coverage,
    ).toBe("history");
  });

  test("refuses a witnessed bundle, which converts as a full or end-of-game record", () => {
    expect(
      convertHistoryMatch(matchId, {
        matchHistory: resolvedGame(),
        timeline,
        endOfGame: { players: [] },
      }),
    ).toBeNull();
    expect(
      convertHistoryMatch(matchId, {
        matchHistory: resolvedGame(),
        timing: { gameStartTimestamp: 1, gameEndTimestamp: 2 },
      }),
    ).toBeNull();
  });

  test("refuses a game the row does not mark complete", () => {
    expect(
      convertHistoryMatch(matchId, {
        matchHistory: {
          ...resolvedGame(),
          endOfGameResult: "Abort_TooFewPlayers",
        },
      }),
    ).toBeNull();
    const { endOfGameResult: _omitted, ...unmarked } = resolvedGame();
    expect(convertHistoryMatch(matchId, { matchHistory: unmarked })).toBeNull();
  });

  test("refuses a one-player list row", () => {
    const resolved = resolvedGame();
    expect(
      convertHistoryMatch(matchId, {
        matchHistory: {
          ...resolved,
          participants: game.participants.slice(0, 1),
          participantIdentities: game.participantIdentities.slice(0, 1),
        },
      }),
    ).toBeNull();
  });

  test("refuses Arena, which Riot publishes", async () => {
    const arena = GameSchema.parse(await fixture("lcu-game-arena"));
    expect(
      convertHistoryMatch(
        RiotMatchIdSchema.parse(`NA1_${arena.gameId.toString()}`),
        { matchHistory: arena },
      ),
    ).toBeNull();
  });
});

test("the unstated field list is exactly the fields the history schema relaxes", () => {
  const strict = new Map<string, z.ZodType>(
    Object.entries(RawParticipantSchema.shape),
  );
  const relaxed = Object.entries(HistoryParticipantSchema.shape)
    .filter(
      ([key, schema]) =>
        schema.safeParse(null).success &&
        strict.get(key)?.safeParse(null).success === false,
    )
    .map(([key]) => key);
  expect(relaxed.toSorted()).toEqual(
    [...HISTORY_UNSTATED_PARTICIPANT_FIELDS].toSorted(),
  );
});

import { describe, expect, test } from "vitest";
import {
  aliasSourceRank,
  mapClientParticipantsToRiot,
} from "./riot-match-aliases.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { riotMatchWithSeats } from "#src/testing/riot-match-seats.ts";

const MATCH_ID = RiotMatchIdSchema.parse("NA1_77");
const SELF_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const FRIEND_UUID = "6a7b8c9d-0e1f-4203-9405-a6b7c8d9e0f1";
const THIRD_UUID = "9c8b7a6d-5e4f-4321-8765-0a1b2c3d4e5f";
const SELF_PUUID = "s".repeat(78);
const FRIEND_PUUID = "f".repeat(78);
const THIRD_PUUID = "t".repeat(78);

type ClientSeat = {
  participantId: number;
  teamId: number;
  championId: number;
  uuid: string;
};

function clientGame(seats: readonly ClientSeat[]) {
  return {
    data: {
      matchHistory: {
        participants: seats.map(({ participantId, teamId, championId }) => ({
          participantId,
          teamId,
          championId,
        })),
        participantIdentities: seats.map((seat) => ({
          participantId: seat.participantId,
          player: { puuid: seat.uuid, gameName: "n", tagLine: "t" },
        })),
      },
    },
  };
}

describe("mapping client participants to a Riot-published game", () => {
  test("maps by participant id, team and champion", async () => {
    const riot = await riotMatchWithSeats(MATCH_ID, [
      { participantId: 1, teamId: 100, championId: 1, puuid: SELF_PUUID },
      { participantId: 2, teamId: 200, championId: 2, puuid: FRIEND_PUUID },
    ]);
    const result = mapClientParticipantsToRiot(
      clientGame([
        { participantId: 1, teamId: 100, championId: 1, uuid: SELF_UUID },
        { participantId: 2, teamId: 200, championId: 2, uuid: FRIEND_UUID },
      ]),
      riot,
    );

    expect(result.refused).toEqual([]);
    expect(result.mappings.map((m) => [m.lcuUuid, m.puuid])).toEqual([
      [SELF_UUID, SELF_PUUID],
      [FRIEND_UUID, FRIEND_PUUID],
    ]);
  });

  test("maps nothing for a seat whose champion is not what Riot recorded", async () => {
    const riot = await riotMatchWithSeats(MATCH_ID, [
      { participantId: 2, teamId: 200, championId: 9, puuid: FRIEND_PUUID },
    ]);
    const result = mapClientParticipantsToRiot(
      clientGame([
        { participantId: 2, teamId: 200, championId: 2, uuid: FRIEND_UUID },
      ]),
      riot,
    );

    expect(result.mappings).toEqual([]);
  });

  test("refuses, rather than guesses, a champion collision on one team", async () => {
    const riot = await riotMatchWithSeats(MATCH_ID, [
      { participantId: 1, teamId: 100, championId: 5, puuid: SELF_PUUID },
      { participantId: 2, teamId: 100, championId: 5, puuid: FRIEND_PUUID },
      { participantId: 3, teamId: 200, championId: 7, puuid: THIRD_PUUID },
    ]);
    const result = mapClientParticipantsToRiot(
      clientGame([
        { participantId: 1, teamId: 100, championId: 5, uuid: SELF_UUID },
        { participantId: 2, teamId: 100, championId: 5, uuid: FRIEND_UUID },
        { participantId: 3, teamId: 200, championId: 7, uuid: THIRD_UUID },
      ]),
      riot,
    );

    expect(result.refused).toEqual([SELF_UUID, FRIEND_UUID]);
    expect(result.mappings.map((m) => m.lcuUuid)).toEqual([THIRD_UUID]);
  });

  test("ignores a payload that is not a client match history", async () => {
    const riot = await riotMatchWithSeats(MATCH_ID, []);
    expect(mapClientParticipantsToRiot({ nope: true }, riot)).toEqual({
      mappings: [],
      refused: [],
    });
  });

  test("ranks riot_match above riot_id", () => {
    expect(aliasSourceRank("riot_match")).toBeGreaterThan(
      aliasSourceRank("riot_id"),
    );
    expect(aliasSourceRank("riot_id")).toBeGreaterThan(
      aliasSourceRank("other"),
    );
  });
});

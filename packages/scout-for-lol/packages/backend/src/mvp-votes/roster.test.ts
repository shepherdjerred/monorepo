import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  freezeMatchMvpRosterFromParticipants,
  indexOfPuuid,
  nomineeAt,
} from "#src/mvp-votes/roster.ts";

function puuid(index: number) {
  return LeaguePuuidSchema.parse(
    `p${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
  );
}

function participant(index: number, participantId: number) {
  return {
    participantId,
    puuid: puuid(index),
    teamId: index < 5 ? (100 as const) : (200 as const),
    championName: `Champ${String(index)}`,
    riotIdGameName: `Player${String(index)}`,
    riotIdTagline: "NA1",
  };
}

describe("freezeMatchMvpRosterFromParticipants", () => {
  test("orders by participantId, not array order", () => {
    const shuffled = [
      participant(9, 10),
      participant(0, 1),
      participant(5, 6),
      participant(1, 2),
      participant(8, 9),
      participant(2, 3),
      participant(7, 8),
      participant(3, 4),
      participant(6, 7),
      participant(4, 5),
    ];
    const roster = freezeMatchMvpRosterFromParticipants("NA1_1", shuffled);
    expect(roster.participants.map((entry) => entry.puuid)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => puuid(index)),
    );
    expect(nomineeAt(roster, 0).championName).toBe("Champ0");
    expect(indexOfPuuid(roster, puuid(9))).toBe(9);
  });

  test("rejects a roster that is not 10 players", () => {
    expect(() =>
      freezeMatchMvpRosterFromParticipants("NA1_1", [participant(0, 1)]),
    ).toThrow(/not 10/u);
  });
});

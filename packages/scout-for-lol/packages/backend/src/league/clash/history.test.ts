import { describe, expect, test } from "vitest";
import { groupClashHistory } from "./history.ts";
import type {
  ClashHistoryMembershipRecord,
  ClashHistorySightingRecord,
} from "./history.ts";

const PUUID = "p".repeat(78);

function sighting(
  overrides: Partial<ClashHistorySightingRecord>,
): ClashHistorySightingRecord {
  return {
    platform: "NA1",
    gameId: "1",
    puuid: PUUID,
    source: "prematch",
    queue: "clash",
    championId: 157,
    observedAt: new Date("2026-09-19T18:00:00.000Z"),
    win: null,
    teamRiotId: null,
    cupKey: "bandle_city",
    cupDay: "day_1",
    ...overrides,
  };
}

describe("groupClashHistory", () => {
  test("numbers lobbies in time order and labels scored leftovers", () => {
    const memberships: ClashHistoryMembershipRecord[] = [
      {
        puuid: PUUID,
        platform: "NA1",
        teamRiotId: "team-1",
        teamName: "WE LOVE VIRMEL",
        teamAbbreviation: "WLV",
        windowStartAt: new Date("2026-09-14T00:00:00.000Z"),
        windowEndAt: new Date("2026-09-27T00:00:00.000Z"),
      },
    ];
    const cups = groupClashHistory({
      sightings: [
        sighting({
          gameId: "1",
          observedAt: new Date("2026-09-19T18:00:00.000Z"),
          teamRiotId: "team-1",
        }),
        sighting({
          gameId: "2",
          observedAt: new Date("2026-09-19T20:00:00.000Z"),
          teamRiotId: "team-1",
        }),
        sighting({
          gameId: "old",
          source: "match",
          win: true,
          cupKey: "demacia",
          cupDay: "day_1",
          observedAt: new Date("2026-01-24T18:00:00.000Z"),
        }),
      ],
      memberships,
      aliasByPuuid: new Map([[PUUID, "Jerred"]]),
    });
    expect(cups[0]?.themeLabel).toBe("Bandle City · Day 1");
    expect(cups[0]?.players[0]?.teamAbbreviation).toBe("WLV");
    expect(cups[0]?.players[0]?.sightings.map((row) => row.matchIndex)).toEqual(
      [1, 2],
    );
    expect(
      cups[0]?.players[0]?.sightings.every((row) => row.outcome === "lobby"),
    ).toBe(true);
    expect(cups[1]?.themeLabel).toBe("Demacia · Day 1");
    expect(cups[1]?.players[0]?.teamName).toBeUndefined();
    expect(cups[1]?.players[0]?.sightings[0]?.outcome).toBe("win");
  });

  test("keeps the same cup theme on different weekends in separate groups", () => {
    const cups = groupClashHistory({
      sightings: [
        sighting({
          gameId: "2026",
          cupKey: "bandle_city",
          cupDay: "day_1",
          observedAt: new Date("2026-09-19T18:00:00.000Z"),
        }),
        sighting({
          gameId: "2027",
          cupKey: "bandle_city",
          cupDay: "day_1",
          observedAt: new Date("2027-09-18T18:00:00.000Z"),
        }),
        sighting({
          gameId: "unknown-a",
          cupKey: null,
          cupDay: null,
          observedAt: new Date("2026-03-07T18:00:00.000Z"),
        }),
        sighting({
          gameId: "unknown-b",
          cupKey: null,
          cupDay: null,
          observedAt: new Date("2026-04-11T18:00:00.000Z"),
        }),
      ],
      memberships: [],
      aliasByPuuid: new Map([[PUUID, "Jerred"]]),
    });
    expect(cups).toHaveLength(4);
    expect(new Set(cups.map((cup) => cup.id)).size).toBe(4);
    expect(
      cups.flatMap((cup) =>
        cup.players.flatMap((player) =>
          player.sightings.map((row) => row.gameId),
        ),
      ),
    ).toEqual(["2027", "2026", "unknown-b", "unknown-a"]);
  });
});

import { describe, expect, test } from "vitest";
import {
  eventDescription,
  eventTeam,
  frameDifference,
  matchQueueLabel,
  projectRiftPosition,
  reviewSnapshots,
  snapshotAt,
  supportsReviewMap,
  type ReviewEvent,
  type ReviewFrame,
} from "./match-review.ts";
import type { MatchTeam } from "#src/components/match/match-scoreboard.tsx";

const objectives = { turrets: 0, inhibitors: 0, barons: 0, dragons: 0 };

test("shows the modern Rift only for compatible maps and versions", () => {
  const match = {
    mapId: 11,
    queueId: 420,
    gameMode: "CLASSIC",
    gameVersion: "16.18.1",
  };
  expect(supportsReviewMap(match)).toBe(true);
  expect(supportsReviewMap({ ...match, mapId: 12 })).toBe(false);
  expect(supportsReviewMap({ ...match, gameVersion: "13.24.1" })).toBe(false);
  expect(supportsReviewMap({ ...match, gameMode: "JADE", queueId: 4310 })).toBe(
    false,
  );
});
const teams: MatchTeam[] = [100, 200].map((teamId, index) => ({
  teamId,
  win: index === 0,
  objectives,
  participants: [
    {
      participantId: index + 1,
      riotId: { gameName: "Player", tagLine: "NA1" },
      championId: index === 0 ? 222 : 22,
      championName: index === 0 ? "Jinx" : "Ashe",
      position: "BOTTOM",
      kills: 1,
      deaths: 1,
      assists: 1,
      creepScore: 100,
      goldEarned: 1000,
      visionScore: 20,
      damageToChampions: 2000,
      killParticipation: 1,
      damageShare: 1,
      objectives,
    },
  ],
}));
function frame(participantId: number, time: number, gold: number): ReviewFrame {
  return {
    participant_id: participantId,
    frame_timestamp_ms: time,
    total_gold: gold,
    xp: gold * 2,
    position_x: 7500,
    position_y: 7500,
    minions_killed: gold / 100,
    jungle_minions_killed: 2,
    level: 10,
  };
}
function event(overrides: Partial<ReviewEvent>): ReviewEvent {
  return {
    id: "event",
    timestampMs: 91_234,
    type: "CHAMPION_KILL",
    killerId: 1,
    victimId: 2,
    teamId: null,
    killerTeamId: null,
    winningTeamId: null,
    monster: null,
    monsterSubtype: null,
    building: null,
    tower: null,
    lane: null,
    participantIds: [1, 2],
    ...overrides,
  };
}

describe("competitive review", () => {
  test("selects the latest snapshot before the exact event time", () => {
    const snapshots = reviewSnapshots(
      [
        frame(1, 60_500, 3000),
        frame(2, 60_500, 2500),
        frame(1, 120_500, 4000),
        frame(2, 120_500, 5000),
      ],
      teams,
    );
    expect(snapshotAt(snapshots, 91_234)?.timestampMs).toBe(60_500);
    expect(snapshotAt(snapshots, 120_500)?.goldDifference).toBe(-1000);
    expect(snapshotAt(snapshots, 20_000)).toBeUndefined();
  });
  test("does not present partial team gold as a complete comparison", () => {
    expect(
      reviewSnapshots([frame(1, 0, 500)], teams)[0]?.goldDifference,
    ).toBeNull();
  });
  test("player differences follow the selected player's perspective", () => {
    const blue = frame(1, 900_000, 5000);
    const red = frame(2, 900_000, 6000);
    expect(frameDifference(red, blue)).toEqual({
      gold: 1000,
      cs: 10,
      xp: 2000,
    });
    expect(frameDifference(blue, red)).toEqual({
      gold: -1000,
      cs: -10,
      xp: -2000,
    });
  });
  test("projects the Rift's Y axis from world to image coordinates", () => {
    expect(projectRiftPosition(0, 0)).toEqual({ x: 0, y: 100 });
    expect(projectRiftPosition(15_000, 15_000)).toEqual({ x: 100, y: 0 });
    expect(projectRiftPosition(7500, 7500)).toEqual({ x: 50, y: 50 });
  });
  test("credits a structure's destruction to the attacker, not its owner", () => {
    const turret = event({
      type: "BUILDING_KILL",
      killerId: 0,
      teamId: 200,
      lane: "BOT_LANE",
      tower: "OUTER_TURRET",
    });
    expect(eventTeam(turret, teams)).toBe(100);
    expect(eventDescription(turret, teams)).toBe(
      "Blue team destroyed bot outer turret",
    );
  });
  test("uses champions and objective names and the winning team", () => {
    expect(eventDescription(event({}), teams)).toBe("Jinx defeated Ashe");
    expect(
      eventDescription(
        event({ type: "ELITE_MONSTER_KILL", monsterSubtype: "FIRE_DRAGON" }),
        teams,
      ),
    ).toBe("Blue team took Infernal Drake");
    expect(
      eventTeam(event({ type: "GAME_END", winningTeamId: 200 }), teams),
    ).toBe(200);
  });
  test("accepts historical queue spelling without exposing raw enums", () => {
    expect(matchQueueLabel("SWIFTPLAY")).toBe(matchQueueLabel("swiftplay"));
    expect(matchQueueLabel(null)).toBe("Match review");
  });
});

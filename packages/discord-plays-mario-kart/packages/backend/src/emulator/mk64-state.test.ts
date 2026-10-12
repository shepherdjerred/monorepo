import { describe, expect, test } from "vitest";
import {
  PLAYER_FLAG_EXISTS,
  PLAYER_FLAG_HUMAN,
  snapshotFromRawState,
  type Mk64RawState,
} from "./mk64-state.ts";

const HUMAN = PLAYER_FLAG_EXISTS | PLAYER_FLAG_HUMAN;

/** A 2P versus race on Luigi Raceway, as the bridge reports it. */
function raceScene(overrides: Partial<Mk64RawState> = {}): Mk64RawState {
  return {
    gamestate: 4, // RACING
    racePhase: 3, // racing ("GO")
    menuSelection: 14, // player-initiated race
    activeScreenMode: 3, // quad
    playerCountSelection: 2,
    modeSelection: 2, // versus
    courseId: 8, // Luigi Raceway
    players: [
      // Human, 1st place (0-based rank 0), Yoshi.
      { type: HUMAN, currentRank: 0, characterId: 2 },
      // Human, 6th place, Bowser.
      { type: HUMAN, currentRank: 5, characterId: 7 },
      // CPU kart.
      { type: PLAYER_FLAG_EXISTS, currentRank: 1, characterId: 0 },
      { type: 0, currentRank: 0, characterId: 0 },
    ],
    hud: [
      { timerCs: 9234, raceComplete: 1 }, // finished at 92.34 s
      { timerCs: 9300, raceComplete: 0 },
      { timerCs: 0, raceComplete: 0 },
      { timerCs: 0, raceComplete: 0 },
    ],
    ...overrides,
  };
}

describe("snapshotFromRawState", () => {
  test("decodes a coherent racing scene", () => {
    const snap = snapshotFromRawState(raceScene());
    expect(snap).toMatchObject({
      raceState: "racing",
      screenMode: "quad",
      gameMode: "versus",
      humanCount: 2,
      courseId: 8,
    });
    expect(snap.players[0]).toEqual({
      present: true,
      human: true,
      rank: 1,
      characterId: 2,
      finished: true,
      raceTimeMs: 92_340,
    });
    expect(snap.players[1]).toMatchObject({
      human: true,
      rank: 6,
      characterId: 7,
      finished: false,
      raceTimeMs: 93_000,
    });
    expect(snap.players[2]).toMatchObject({ present: true, human: false });
    expect(snap.players[3]).toMatchObject({ present: false });
  });

  test("race phases map to normalized race states", () => {
    for (const [racePhase, expected] of [
      [0, "staging"],
      [2, "staging"],
      [3, "racing"],
      [4, "finished"],
      [5, "finished"],
      [6, "menu"],
    ] as const) {
      expect(snapshotFromRawState(raceScene({ racePhase })).raceState).toBe(
        expected,
      );
    }
    // Out of the racing gamestate entirely (e.g. main menu).
    expect(snapshotFromRawState(raceScene({ gamestate: 0 })).raceState).toBe(
      "menu",
    );
    // The attract demo: gamestate races, but the menu stays on the logo.
    expect(
      snapshotFromRawState(raceScene({ menuSelection: 8 })).raceState,
    ).toBe("menu");
  });

  test("garbage globals degrade to a menu snapshot", () => {
    const snap = snapshotFromRawState(raceScene({ courseId: 999 }));
    expect(snap.raceState).toBe("menu");
    expect(snap.courseId).toBe(-1);
    expect(snap.players).toEqual([]);
  });

  test("an out-of-range timer is capped and an out-of-range rank reads as 0", () => {
    const scene = raceScene();
    const snap = snapshotFromRawState({
      ...scene,
      players: [
        { type: HUMAN, currentRank: 0x7f_ff, characterId: 2 },
        ...scene.players.slice(1),
      ],
      hud: [{ timerCs: 0xff_ff_ff_ff, raceComplete: 1 }, ...scene.hud.slice(1)],
    });
    expect(snap.players[0]?.raceTimeMs).toBe(86_400_000);
    expect(snap.players[0]?.rank).toBe(0);
  });

  test("a record missing a player slot is a broken contract", () => {
    const scene = raceScene();
    expect(() =>
      snapshotFromRawState({ ...scene, players: scene.players.slice(0, 3) }),
    ).toThrow(/missing slot 3/);
  });
});

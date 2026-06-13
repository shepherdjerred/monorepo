import { describe, expect, test } from "bun:test";
import type {
  Mk64PlayerSnapshot,
  Mk64Snapshot,
  RaceState,
} from "#src/emulator/mk64-memory.ts";
import { RaceWatcher } from "./race-watcher.ts";
import type { RaceCompleted } from "./race-watcher.ts";

type PlayerOverride = Partial<Mk64PlayerSnapshot>;

function player(over: PlayerOverride = {}): Mk64PlayerSnapshot {
  return {
    present: true,
    human: false,
    rank: 0,
    characterId: 0,
    finished: false,
    raceTimeMs: 0,
    ...over,
  };
}

function snap(
  state: RaceState,
  players: PlayerOverride[] = [],
  over: Partial<Mk64Snapshot> = {},
): Mk64Snapshot {
  return {
    raceState: state,
    screenMode: "quad",
    gameMode: "versus",
    humanCount: players.filter((p) => p.human === true).length || 1,
    courseId: 8, // Luigi Raceway
    players: players.map((p) => player(p)),
    ...over,
  };
}

/** Feed the same snapshot N times (>= confirmPolls) and collect emissions. */
function feed(
  watcher: RaceWatcher,
  s: Mk64Snapshot,
  times = 3,
): RaceCompleted[] {
  const out: RaceCompleted[] = [];
  for (let i = 0; i < times; i++) {
    const r = watcher.update(s);
    if (r !== null) out.push(r);
  }
  return out;
}

const twoHumans: PlayerOverride[] = [
  { human: true, rank: 2, characterId: 2 },
  { human: true, rank: 5, characterId: 7 },
  { rank: 1 },
  { rank: 3 },
];

function makeWatcher(names: (string | null)[] = ["Jerred", "Alice"]) {
  let current = names;
  const watcher = new RaceWatcher({ seatNames: () => current });
  return {
    watcher,
    setNames: (n: (string | null)[]) => {
      current = n;
    },
  };
}

describe("RaceWatcher — race recording", () => {
  test("clean race emits exactly once with placements and times from finish edges", () => {
    const { watcher } = makeWatcher();
    expect(feed(watcher, snap("menu"))).toEqual([]);
    expect(feed(watcher, snap("staging", twoHumans))).toEqual([]);
    expect(feed(watcher, snap("racing", twoHumans))).toEqual([]);

    // P1 crosses the line: rank/time latch at the edge.
    const p1Done: PlayerOverride[] = [
      {
        human: true,
        rank: 1,
        characterId: 2,
        finished: true,
        raceTimeMs: 92_340,
      },
      { human: true, rank: 5, characterId: 7, raceTimeMs: 93_000 },
      { rank: 2 },
      { rank: 3 },
    ];
    expect(feed(watcher, snap("racing", p1Done))).toEqual([]);

    // P1's live rank drifts after finishing (CPU takeover) — must not matter.
    const p2Done: PlayerOverride[] = [
      {
        human: true,
        rank: 3,
        characterId: 2,
        finished: true,
        raceTimeMs: 99_999,
      },
      {
        human: true,
        rank: 4,
        characterId: 7,
        finished: true,
        raceTimeMs: 101_200,
      },
      { rank: 1 },
      { rank: 2 },
    ];
    const emitted = feed(watcher, snap("finished", p2Done), 6);
    expect(emitted).toHaveLength(1);
    const race = emitted[0];
    expect(race).toMatchObject({
      courseId: 8,
      gameMode: "versus",
      screenMode: "quad",
      humanCount: 2,
    });
    expect(race?.results).toEqual([
      {
        seat: 0,
        name: "Jerred",
        characterId: 2,
        placement: 1,
        raceTimeMs: 92_340,
        finished: true,
      },
      {
        seat: 1,
        name: "Alice",
        characterId: 7,
        placement: 4,
        raceTimeMs: 101_200,
        finished: true,
      },
    ]);
  });

  test("roster names are frozen at race start", () => {
    const { watcher, setNames } = makeWatcher(["Jerred", "Alice"]);
    feed(watcher, snap("racing", twoHumans));
    setNames(["Impostor", null]); // rename / seat re-claim mid-race

    const done: PlayerOverride[] = [
      {
        human: true,
        rank: 1,
        finished: true,
        raceTimeMs: 90_000,
        characterId: 2,
      },
      {
        human: true,
        rank: 2,
        finished: true,
        raceTimeMs: 91_000,
        characterId: 7,
      },
    ];
    const emitted = feed(watcher, snap("finished", done), 6);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.results.map((r) => r.name)).toEqual(["Jerred", "Alice"]);
  });

  test("quit to menu mid-race discards without emitting; next race still records", () => {
    const { watcher } = makeWatcher();
    feed(watcher, snap("racing", twoHumans));
    expect(feed(watcher, snap("menu", []), 6)).toEqual([]);

    feed(watcher, snap("racing", twoHumans));
    const done: PlayerOverride[] = [
      { human: true, rank: 1, finished: true, raceTimeMs: 1000 },
      { human: true, rank: 2, finished: true, raceTimeMs: 2000 },
    ];
    expect(feed(watcher, snap("finished", done), 6)).toHaveLength(1);
  });

  test("transient flapping below confirmPolls never transitions", () => {
    const { watcher } = makeWatcher();
    // Garbage flickers: each state seen < 3 consecutive times.
    for (let i = 0; i < 10; i++) {
      expect(watcher.update(snap("racing", twoHumans))).toBeNull();
      expect(watcher.update(snap("menu"))).toBeNull();
      expect(watcher.update(snap("finished", twoHumans))).toBeNull();
    }
  });

  test("all-humans-finished emits even if the phase never reads finished", () => {
    const { watcher } = makeWatcher();
    feed(watcher, snap("racing", twoHumans));
    const done: PlayerOverride[] = [
      { human: true, rank: 1, finished: true, raceTimeMs: 1000 },
      { human: true, rank: 2, finished: true, raceTimeMs: 2000 },
    ];
    // raceState still "racing", but every roster human has crossed the line.
    const emitted = feed(watcher, snap("racing", done), 1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.results.every((r) => r.finished)).toBe(true);
  });

  test("outcome decided before a human crosses: live rank, finished=false", () => {
    const { watcher } = makeWatcher();
    feed(watcher, snap("racing", twoHumans));
    const decided: PlayerOverride[] = [
      { human: true, rank: 1, finished: true, raceTimeMs: 88_000 },
      { human: true, rank: 6, raceTimeMs: 90_000 }, // never finished
    ];
    const emitted = feed(watcher, snap("finished", decided), 6);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.results[1]).toMatchObject({
      seat: 1,
      placement: 6,
      finished: false,
    });
  });

  test("sitting on the results screen never double-emits; re-arms after menu", () => {
    const { watcher } = makeWatcher();
    feed(watcher, snap("racing", twoHumans));
    const done: PlayerOverride[] = [
      { human: true, rank: 1, finished: true, raceTimeMs: 1000 },
      { human: true, rank: 2, finished: true, raceTimeMs: 2000 },
    ];
    expect(feed(watcher, snap("finished", done), 50)).toHaveLength(1);
    expect(feed(watcher, snap("menu"), 6)).toEqual([]);
    // Back-to-back second race.
    feed(watcher, snap("racing", twoHumans));
    expect(feed(watcher, snap("finished", done), 6)).toHaveLength(1);
  });
});

describe("RaceWatcher — isRecordable filtering", () => {
  test("battle mode and award ceremony are never recorded", () => {
    const { watcher } = makeWatcher();
    const battle = snap("racing", twoHumans, { gameMode: "battle" });
    const doneBattle = snap(
      "finished",
      [
        { human: true, rank: 1, finished: true },
        { human: true, rank: 2, finished: true },
      ],
      { gameMode: "battle" },
    );
    expect(feed(watcher, battle, 6)).toEqual([]);
    expect(feed(watcher, doneBattle, 6)).toEqual([]);

    const ceremony = snap("racing", twoHumans, { courseId: 0x14 });
    expect(feed(watcher, ceremony, 6)).toEqual([]);
  });

  test("time-trials are never recorded (excluded by isRecordable)", () => {
    const { watcher } = makeWatcher(["Jerred"]);
    const tt: PlayerOverride[] = [
      { human: true, rank: 1, characterId: 0 },
      { human: false, rank: 2 }, // ghost
      { present: false },
      { present: false },
    ];
    feed(watcher, snap("racing", tt, { gameMode: "time-trials" }));
    const done: PlayerOverride[] = [
      {
        human: true,
        rank: 1,
        characterId: 0,
        finished: true,
        raceTimeMs: 75_500,
      },
      { human: false, rank: 2 },
      { present: false },
      { present: false },
    ];
    const emitted = feed(
      watcher,
      snap("finished", done, { gameMode: "time-trials" }),
      6,
    );
    expect(emitted).toHaveLength(0);
  });

  test("non-human ghost karts in slots 1+ are excluded from the versus roster", () => {
    const { watcher } = makeWatcher(["Jerred"]);
    const withGhost: PlayerOverride[] = [
      { human: true, rank: 1, characterId: 0 },
      { human: false, rank: 2 }, // CPU / ghost
      { present: false },
      { present: false },
    ];
    feed(watcher, snap("racing", withGhost));
    const done: PlayerOverride[] = [
      {
        human: true,
        rank: 1,
        characterId: 0,
        finished: true,
        raceTimeMs: 75_500,
      },
      { human: false, rank: 2 },
      { present: false },
      { present: false },
    ];
    const emitted = feed(watcher, snap("finished", done), 6);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.results).toHaveLength(1);
    expect(emitted[0]?.results[0]?.seat).toBe(0);
  });
});

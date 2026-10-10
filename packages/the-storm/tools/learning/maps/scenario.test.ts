import { expect, test } from "vitest";
import {
  MapContent,
  MapScenario,
  sourceScenario,
  validateScenario,
} from "./scenario.ts";
import { controlledMap } from "./stage.ts";

function fourTeamMap() {
  return MapContent.parse({
    id: "original-isles",
    name: "Original Isles",
    author: "builder",
    region: {
      min: { x: 1024, y: 30, z: 2048 },
      max: { x: 1150, y: 60, z: 2174 },
    },
    spectator: { x: 1087, y: 58, z: 2111, yaw: 0, pitch: 45 },
    teams: ["PURPLE", "RED", "GREEN", "BLUE"].map((color, index) => ({
      color,
      spawns: [{ x: 1030.5 + index * 20, y: 35, z: 2055.5, yaw: 90, pitch: 0 }],
    })),
    bombs: ["PURPLE", "RED", "GREEN", "BLUE"].map((team, index) => ({
      id: `${team.toLowerCase()}-1`,
      team,
      at: { x: 1030 + index * 20, y: 35, z: 2055 },
    })),
    nukes: [],
    blocksSha256: "a".repeat(64),
  });
}

test("four-team original supplies a deterministic duel without changing its terrain or live metadata", () => {
  const map = fourTeamMap();
  const before = JSON.stringify(map);
  const scenario = sourceScenario(map);
  expect(scenario.mapSha256).toBe(map.blocksSha256);
  expect(scenario.region).toEqual(map.region);
  expect(scenario.sourceTeams).toEqual(["PURPLE", "RED", "GREEN", "BLUE"]);
  expect(scenario.spawns.map((spawn) => spawn.sourceTeam)).toEqual([
    "RED",
    "BLUE",
  ]);
  expect(() => validateScenario(scenario, map)).not.toThrow();
  expect(JSON.stringify(sourceScenario(map))).toBe(JSON.stringify(scenario));
  expect(JSON.stringify(map)).toBe(before);
  const duel = controlledMap(map, scenario);
  expect(duel.teams.map((team) => team.color)).toEqual(["RED", "BLUE"]);
  expect(duel.bombs.map((bomb) => bomb.team)).toEqual(["RED", "BLUE"]);
  expect(duel.region).toEqual(map.region);
  expect(duel.blocksSha256).toBe(map.blocksSha256);
  expect(map.teams).toHaveLength(4);
});

test("rejects stale terrain bindings, invented source positions, repeated teams and out of bounds starts", () => {
  const map = fourTeamMap();
  const scenario = sourceScenario(map);
  expect(() =>
    validateScenario({ ...scenario, mapSha256: "b".repeat(64) }, map),
  ).toThrow("terrain");
  const [first, second] = scenario.spawns;
  if (first === undefined || second === undefined)
    throw new Error("Missing test scenario spawn");
  expect(() =>
    validateScenario(
      {
        ...scenario,
        spawns: [{ ...first, position: [1040.5, 35, 2055.5] }, second],
      },
      map,
    ),
  ).toThrow("invented");
  expect(() =>
    MapScenario.parse({ ...scenario, spawns: [first, first] }),
  ).toThrow("repeats");
  expect(() =>
    MapScenario.parse({ ...scenario, spawns: [second, first] }),
  ).toThrow("order");
  expect(() =>
    MapScenario.parse({
      ...scenario,
      spawns: [
        { ...first, position: [map.region.max.x + 1, 35, 2055.5] },
        second,
      ],
    }),
  ).toThrow("outside");
  expect(() =>
    MapScenario.parse({
      ...scenario,
      spawns: [{ ...first, position: [0, 0, 0] }, second],
    }),
  ).toThrow("outside");
});

test.each(["source", "authored"] as const)(
  "%s duel staging uses exactly the declared starts, preserving original spawn metadata",
  (spawnPolicy) => {
    const map = fourTeamMap();
    const red = map.teams.find((team) => team.color === "RED");
    if (red === undefined) throw new Error("Missing test team");
    const alternate = { x: 1055.5, y: 35, z: 2060.5, yaw: 270, pitch: 0 };
    red.spawns.push(alternate);
    const original = JSON.stringify(map);
    const scenario = sourceScenario(map);
    const first = scenario.spawns[0];
    if (first === undefined) throw new Error("Missing test scenario start");
    const selected = MapScenario.parse({
      ...scenario,
      spawnPolicy,
      spawns: [
        {
          ...first,
          position: [
            alternate.x + (spawnPolicy === "authored" ? 1 : 0),
            alternate.y,
            alternate.z,
          ],
          yaw: spawnPolicy === "authored" ? -90 : alternate.yaw,
          pitch: alternate.pitch,
        },
        scenario.spawns[1],
      ],
    });
    const duel = controlledMap(map, selected);
    expect(duel.teams.map((team) => team.spawns)).toEqual([
      [{ ...alternate, x: selected.spawns[0]?.position[0] }],
      map.teams.find((team) => team.color === "BLUE")?.spawns,
    ]);
    expect(duel.region).toEqual(map.region);
    expect(duel.blocksSha256).toBe(map.blocksSha256);
    expect(JSON.stringify(map)).toBe(original);
  },
);

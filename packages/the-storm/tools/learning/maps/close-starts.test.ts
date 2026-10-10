import { expect, test } from "vitest";
import { MapContent } from "./scenario.ts";
import { closeScenario } from "./close-starts.ts";

const map = MapContent.parse({
  id: "original-castles",
  name: "Original Castles",
  author: "builder",
  region: { min: { x: 100, y: 30, z: 200 }, max: { x: 199, y: 60, z: 299 } },
  spectator: { x: 150, y: 60, z: 250, yaw: 0, pitch: 0 },
  teams: ["PURPLE", "GREEN", "RED", "BLUE"].map((color, index) => ({
    color,
    spawns: [{ x: 110 + index * 20, y: 35, z: 210, yaw: 0, pitch: 0 }],
  })),
  bombs: ["PURPLE", "GREEN", "RED", "BLUE"].map((team, index) => ({
    id: `${team.toLowerCase()}-1`,
    team,
    at: { x: 110 + index * 20, y: 35, z: 210 },
  })),
  nukes: [],
  blocksSha256: "a".repeat(64),
});
type Start = { position: [number, number, number]; yaw: number; pitch: number };
const receipt = () => ({
  schema: 1,
  kind: "rwf-close-starts",
  map: map.id,
  blocksSha256: map.blocksSha256,
  starts: [
    { position: [140.5, 35, 240.5], yaw: -90, pitch: 0 },
    { position: [152.5, 35, 240.5], yaw: 90, pitch: 0 },
  ] satisfies [Start, Start],
});

test("binds exact authored starts while preserving full original metadata and selected team identity", () => {
  const original = JSON.stringify(map);
  const scenario = closeScenario(map, receipt());
  expect(scenario.spawnPolicy).toBe("authored");
  expect(scenario.spawns.map((spawn) => spawn.sourceTeam)).toEqual([
    "RED",
    "BLUE",
  ]);
  expect(scenario.spawns.map((spawn) => spawn.position)).toEqual(
    receipt().starts.map((spawn) => spawn.position),
  );
  expect(scenario.sourceTeams).toEqual(map.teams.map((team) => team.color));
  expect(scenario.region).toEqual(map.region);
  expect(scenario.mapSha256).toBe(map.blocksSha256);
  expect(JSON.stringify(map)).toBe(original);
});

test("rejects stale, unknown, elevated, distant, out-of-bounds and misfacing geometry receipts", () => {
  const edits = [
    (raw: ReturnType<typeof receipt>) => ({ ...raw, extra: true }),
    (raw: ReturnType<typeof receipt>) => ({
      ...raw,
      blocksSha256: "b".repeat(64),
    }),
    (raw: ReturnType<typeof receipt>) => ({ ...raw, map: "foreign-map" }),
    (raw: ReturnType<typeof receipt>) => {
      raw.starts[1].position[1] = 36;
      return raw;
    },
    (raw: ReturnType<typeof receipt>) => {
      raw.starts[1].position[0] = 170;
      return raw;
    },
    (raw: ReturnType<typeof receipt>) => {
      raw.starts[0].position[0] = 97;
      raw.starts[1].position[0] = 109;
      return raw;
    },
    (raw: ReturnType<typeof receipt>) => {
      raw.starts[0].yaw = 0;
      return raw;
    },
  ];
  for (const edit of edits)
    expect(() => closeScenario(map, edit(receipt()))).toThrow();
});

import { z } from "zod";
import wire from "#learning-map-wire";
import registry from "#learning-map-scenarios";

const identity = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const point = z.strictObject({ x: z.number(), y: z.number(), z: z.number() });
const region = z.strictObject({ min: point, max: point });
const color = z.enum(wire.teamColors);
const spawn = point.extend({
  yaw: z.number(),
  pitch: z.number().min(-90).max(90),
});
export const MapContent = z.strictObject({
  id: identity,
  name: z.string().min(1),
  author: z.string().min(1),
  region,
  spectator: spawn,
  teams: z
    .array(z.strictObject({ color, spawns: z.array(spawn).min(1) }))
    .min(2),
  bombs: z
    .array(z.strictObject({ id: identity, team: color, at: point }))
    .min(2),
  nukes: z.array(z.strictObject({ id: identity, at: point })),
  blocksSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type MapContent = z.infer<typeof MapContent>;

const ScenarioSpawn = z.strictObject({
  team: z.enum(["red", "blue"]),
  sourceTeam: color,
  position: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number().transform(Math.fround),
  pitch: z.number().min(-90).max(90).transform(Math.fround),
});
export const MapScenario = z
  .strictObject({
    schema: z.literal(1),
    kind: z.literal("rwf-map-scenario"),
    id: identity,
    map: identity,
    mapSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    world: z.literal("minecraft:rwf"),
    region,
    sourceTeams: z.array(color).min(2).max(5),
    spawnPolicy: z.enum(["source", "authored"]),
    spawns: z.array(ScenarioSpawn).length(2),
  })
  .superRefine((scenario, context) => {
    const distinct = [
      scenario.sourceTeams,
      scenario.spawns.map((entry) => entry.team),
      scenario.spawns.map((entry) => entry.sourceTeam),
    ];
    if (distinct.some((values) => new Set(values).size !== values.length))
      context.addIssue({ code: "custom", message: "Scenario repeats a team" });
    if (
      scenario.spawns[0]?.team !== "red" ||
      scenario.spawns[1]?.team !== "blue"
    )
      context.addIssue({
        code: "custom",
        message: "Scenario spawn order must be red, blue",
      });
    for (const entry of scenario.spawns) {
      const [x, y, south] = entry.position;
      const { min, max } = scenario.region;
      if (
        !scenario.sourceTeams.includes(entry.sourceTeam) ||
        x < min.x ||
        x >= max.x + 1 ||
        y < min.y ||
        y > max.y ||
        south < min.z ||
        south >= max.z + 1
      )
        context.addIssue({
          code: "custom",
          message: "Scenario spawn is outside its source map",
        });
    }
  });
export type MapScenario = z.infer<typeof MapScenario>;

export const mapScenarios = z
  .strictObject({
    schema: z.literal(1),
    kind: z.literal("rwf-map-scenarios"),
    scenarios: z.array(MapScenario).min(1),
  })
  .parse(registry).scenarios;
if (
  new Set(mapScenarios.map((scenario) => scenario.map)).size !==
  mapScenarios.length
)
  throw new Error("Map scenario registry repeats a map");

export function scenarioFor(map: string): MapScenario {
  const scenario = mapScenarios.find((candidate) => candidate.map === map);
  if (scenario === undefined)
    throw new Error(`No validated scenario for map ${map}`);
  return scenario;
}

if (
  wire.version !== 1 ||
  wire.kind !== "rwf-map-scenario" ||
  JSON.stringify(wire.fields) !==
    JSON.stringify(Object.keys(MapScenario.shape)) ||
  JSON.stringify(wire.spawnFields) !==
    JSON.stringify(Object.keys(ScenarioSpawn.shape))
)
  throw new Error("Map scenario validator differs from its neutral contract");

/** Each original keeps its entire terrain; only the disposable duel roster is reduced. */
export function sourceScenario(map: MapContent): MapScenario {
  const red = map.teams.find((team) => team.color === "RED") ?? map.teams[0];
  const blue =
    map.teams.find((team) => team.color === "BLUE" && team !== red) ??
    map.teams.find((team) => team !== red);
  if (red === undefined || blue === undefined)
    throw new Error("Map needs two distinct source teams");
  return MapScenario.parse({
    schema: 1,
    kind: "rwf-map-scenario",
    id: `${map.id}-trooper-duel-v1`,
    map: map.id,
    mapSha256: map.blocksSha256,
    world: wire.world,
    region: map.region,
    sourceTeams: map.teams.map((team) => team.color),
    spawnPolicy: "source",
    spawns: [red, blue].map((team, index) => {
      const at = team.spawns[0];
      if (at === undefined) throw new Error("Source team has no spawn");
      return {
        team: index === 0 ? "red" : "blue",
        sourceTeam: team.color,
        position: [at.x, at.y, at.z],
        yaw: at.yaw,
        pitch: at.pitch,
      };
    }),
  });
}

export function validateScenario(scenario: MapScenario, map: MapContent): void {
  if (
    scenario.map !== map.id ||
    scenario.mapSha256 !== map.blocksSha256 ||
    JSON.stringify(scenario.region) !== JSON.stringify(map.region) ||
    JSON.stringify(scenario.sourceTeams) !==
      JSON.stringify(map.teams.map((team) => team.color))
  )
    throw new Error(
      "Scenario differs from its original map metadata or terrain",
    );
  if (scenario.spawnPolicy === "source") {
    for (const entry of scenario.spawns) {
      const team = map.teams.find(
        (candidate) => candidate.color === entry.sourceTeam,
      );
      if (
        team?.spawns.some(
          (at) =>
            JSON.stringify([at.x, at.y, at.z]) ===
              JSON.stringify(entry.position) &&
            Math.fround(at.yaw) === entry.yaw &&
            Math.fround(at.pitch) === entry.pitch,
        ) !== true
      )
        throw new Error("Scenario invented a source spawn");
    }
  }
}

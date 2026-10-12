import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import wire from "#learning-training-map-scenarios";
import {
  MapScenario,
  mapScenarios,
  type MapScenario as Scenario,
} from "./scenario.ts";

const catalog = z
  .strictObject({
    schema: z.literal(1),
    kind: z.literal("rwf-training-map-scenarios"),
    scenarios: z.array(MapScenario).min(1),
  })
  .parse(wire);

export const trainingMapScenarios = catalog.scenarios;

const registered = new Map(
  mapScenarios.map((scenario) => [scenario.map, scenario]),
);
const training = new Map<string, Scenario>();
for (const scenario of trainingMapScenarios) {
  const source = registered.get(scenario.map);
  if (
    source === undefined ||
    scenario.id !== `${scenario.map}-close-trooper-duel-v1` ||
    scenario.spawnPolicy !== "authored" ||
    scenario.mapSha256 !== source.mapSha256 ||
    !isDeepStrictEqual(scenario.region, source.region) ||
    !isDeepStrictEqual(scenario.sourceTeams, source.sourceTeams) ||
    training.has(scenario.map)
  )
    throw new Error(
      `Training scenario for ${scenario.map} differs from its neutral map identity`,
    );
  training.set(scenario.map, scenario);
}
if (
  !isDeepStrictEqual([...training.keys()].sort(), [...registered.keys()].sort())
)
  throw new Error("Training scenarios do not cover the admitted map registry");

export function trainingScenarioFor(map: string): Scenario {
  const scenario = training.get(map);
  if (scenario === undefined)
    throw new Error(`No controlled training scenario for map ${map}`);
  return scenario;
}

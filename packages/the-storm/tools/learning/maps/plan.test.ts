import path from "node:path";
import { expect, test } from "vitest";
import { TrainingMaps, trainingMaps, validateCatalogIds } from "./plan.ts";
import {
  MapContent,
  MapScenario,
  mapScenarios,
  validateScenario,
} from "./scenario.ts";

test("admits the owned catalog and rejects map-set or scenario identity changes", async () => {
  const source = path.resolve(
    import.meta.dirname,
    "../../../server/owned/plugins/TheStorm",
  );
  const admitted = await trainingMaps(source, false);
  const registered = mapScenarios.map((scenario) => scenario.map).sort();
  expect(admitted.maps.map((entry) => entry.map)).toEqual(registered);
  const diagnostic = await trainingMaps(source, true);
  expect(diagnostic.maps.map((entry) => entry.map)).toEqual(["training-yard"]);
  expect(() =>
    validateCatalogIds([...registered, "unregistered"], registered),
  ).toThrow("registry");
  expect(() => validateCatalogIds(registered.slice(1), registered)).toThrow(
    "registry",
  );
  const directory = path.join(source, "rwf/maps/training-yard");
  const map = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(directory, "map.yml")).text()),
  );
  const scenario = MapScenario.parse(
    await Bun.file(path.join(directory, "scenario.json")).json(),
  );
  expect(() =>
    validateScenario({ ...scenario, mapSha256: "f".repeat(64) }, map),
  ).toThrow("terrain");
});

test("map bindings cannot be empty, duplicated, reordered, malformed or carry unknown fields", () => {
  const binding = {
    map: "isles",
    blocksSha256: "a".repeat(64),
    scenarioSha256: "b".repeat(64),
  };
  const envelope = { schema: 1, kind: "rwf-training-maps" };
  for (const maps of [
    [],
    [binding, binding],
    [{ ...binding, map: "yard" }, binding],
    [{ ...binding, blocksSha256: "a" }],
    [{ ...binding, map: "../outside" }],
    [{ ...binding, extra: true }],
  ])
    expect(() => TrainingMaps.parse({ ...envelope, maps })).toThrow();
});

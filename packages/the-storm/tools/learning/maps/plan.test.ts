import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { TrainingMaps, trainingMaps } from "./plan.ts";
import { MapScenario } from "./scenario.ts";

test("freezes admitted owned maps and rejects extra installed maps or changed scenario identities", async () => {
  const source = path.resolve(
    import.meta.dirname,
    "../../../server/owned/plugins/TheStorm",
  );
  const admitted = await trainingMaps(source, false);
  expect(admitted.maps.map((entry) => entry.map)).toEqual(["training-yard"]);
  expect(await trainingMaps(source, true)).toEqual(admitted);
  const temporary = await mkdtemp(path.join(tmpdir(), "rwf-training-plan-"));
  try {
    const maps = path.join(temporary, "rwf/maps");
    await cp(
      path.join(source, "rwf/maps/training-yard"),
      path.join(maps, "training-yard"),
      { recursive: true },
    );
    await mkdir(path.join(maps, "unregistered"));
    await expect(trainingMaps(temporary, false)).rejects.toThrow("registry");
    await rm(path.join(maps, "unregistered"), { recursive: true });
    const file = path.join(maps, "training-yard/scenario.json");
    const raw: unknown = await Bun.file(file).json();
    const scenario = MapScenario.parse(raw);
    await Bun.write(
      file,
      JSON.stringify({ ...scenario, mapSha256: "f".repeat(64) }),
    );
    await expect(trainingMaps(temporary, false)).rejects.toThrow("terrain");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
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

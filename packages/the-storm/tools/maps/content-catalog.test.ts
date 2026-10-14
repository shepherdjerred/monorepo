import path from "node:path";
import { readdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  MapContent,
  MapScenario,
  mapScenarios,
  validateScenario,
} from "#learning/maps/scenario.ts";
import trainingRegistry from "#learning-training-map-scenarios";
import { Details, isShopSign } from "./content/shops.ts";

describe("expanded owned content", () => {
  test("all 44 installed maps have terrain-bound source and controlled training scenarios", async () => {
    const root = path.resolve(
      import.meta.dir,
      "../../server/owned/plugins/TheStorm/rwf/maps",
    );
    const entries = await readdir(root, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const training = z
      .object({ scenarios: z.array(MapScenario) })
      .parse(trainingRegistry).scenarios;
    expect(ids).toHaveLength(44);
    expect(mapScenarios.map((scenario) => scenario.map).sort()).toEqual(ids);
    expect(training.map((scenario) => scenario.map).sort()).toEqual(ids);
    let removedCount = 0;
    let retainedSigns = 0;
    for (const id of ids) {
      const folder = path.join(root, id);
      const map = MapContent.parse(
        Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
      );
      const installed = MapScenario.parse(
        await Bun.file(path.join(folder, "scenario.json")).json(),
      );
      const source = mapScenarios.find((scenario) => scenario.map === id);
      const controlled = training.find((scenario) => scenario.map === id);
      expect(installed).toEqual(source);
      if (source === undefined || controlled === undefined)
        throw new Error(`Missing scenario for ${id}`);
      validateScenario(source, map);
      validateScenario(controlled, map);
      expect(controlled.spawnPolicy).toBe("authored");
      const details = Details.parse(
        await Bun.file(path.join(folder, "details.json")).json(),
      );
      expect(details.blocksSha256).toBe(map.blocksSha256);
      expect(details.signs.some((sign) => isShopSign(sign))).toBe(false);
      retainedSigns += details.signs.length;
      const receipt = Bun.file(path.join(folder, "removed-shops.json"));
      if (await receipt.exists()) {
        const removal = z
          .object({ blocksSha256: z.string(), removed: z.array(z.unknown()) })
          .parse(await receipt.json());
        expect(removal.blocksSha256).toBe(map.blocksSha256);
        removedCount += removal.removed.length;
      }
    }
    expect(removedCount).toBe(459);
    expect(retainedSigns).toBe(340);
  });
});

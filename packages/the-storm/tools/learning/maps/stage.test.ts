import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { stageMap } from "./stage.ts";
import { MapScenario, scenarioFor } from "./scenario.ts";
import { trainingScenarioFor } from "./training-scenarios.ts";

test("stages the frozen controlled scenario in a private copy only", async () => {
  const source = path.resolve(
    import.meta.dirname,
    "../../../server/owned/plugins/TheStorm",
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "rwf-training-map-"));
  const output = path.join(temporary, "stage");
  try {
    const staged = await stageMap(source, output, "training-yard", {
      duel: false,
      mapTool: "unused",
      trainingScenario: trainingScenarioFor("training-yard"),
    });
    const stagedScenario = MapScenario.parse(
      JSON.parse(
        await readFile(path.join(staged.selected, "scenario.json"), "utf8"),
      ),
    );
    const ownedScenario = MapScenario.parse(
      JSON.parse(
        await readFile(
          path.join(source, "rwf/maps/training-yard/scenario.json"),
          "utf8",
        ),
      ),
    );
    expect(stagedScenario).toEqual(trainingScenarioFor("training-yard"));
    expect(stagedScenario).not.toEqual(ownedScenario);
    expect(ownedScenario).toEqual(scenarioFor("training-yard"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("refuses a controlled scenario that is not in the frozen training catalog", async () => {
  const source = path.resolve(
    import.meta.dirname,
    "../../../server/owned/plugins/TheStorm",
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "rwf-training-map-"));
  try {
    const training = trainingScenarioFor("training-yard");
    await expect(
      stageMap(source, path.join(temporary, "stage"), "training-yard", {
        duel: false,
        mapTool: "unused",
        trainingScenario: { ...training, id: "training-yard-unreviewed" },
      }),
    ).rejects.toThrow("frozen catalog");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

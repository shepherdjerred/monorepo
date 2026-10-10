import path from "node:path";
import { readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  MapContent,
  MapScenario,
  mapScenarios,
  validateScenario,
} from "./scenario.ts";
import contract from "./protocol.json";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const MapBinding = z.strictObject({
  map: MapScenario.shape.map,
  blocksSha256: digest,
  scenarioSha256: digest,
});
export type MapBinding = z.infer<typeof MapBinding>;
export const MapCatalog = z
  .array(MapBinding)
  .min(1)
  .superRefine((maps, context) => {
    const ids = maps.map((entry) => entry.map);
    if (
      new Set(ids).size !== ids.length ||
      !isDeepStrictEqual(ids, [...ids].sort())
    )
      context.addIssue({
        code: "custom",
        message: "Training maps must be unique and sorted",
      });
  });
export const TrainingMaps = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-training-maps"),
  maps: MapCatalog,
});
export type TrainingMaps = z.infer<typeof TrainingMaps>;
if (
  contract.schema !== 1 ||
  contract.kind !== "rwf-training-maps" ||
  contract.selection !== "paired-round-robin" ||
  !isDeepStrictEqual(contract.fields, Object.keys(TrainingMaps.shape)) ||
  !isDeepStrictEqual(contract.mapFields, Object.keys(MapBinding.shape))
)
  throw new Error("Training map validators differ from their neutral contract");

export function scenarioHash(scenario: z.infer<typeof MapScenario>): string {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(scenario))
    .digest("hex");
}

/** Every installed map must have the same admitted scenario in owned content and the registry. */
export async function trainingMaps(
  content: string,
  diagnostic: boolean,
): Promise<TrainingMaps> {
  const folder = path.join(content, "rwf/maps");
  const entries = await readdir(folder, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const registered = mapScenarios.map((scenario) => scenario.map).sort();
  if (!isDeepStrictEqual(ids, registered))
    throw new Error(
      "Installed training maps differ from the admitted scenario registry",
    );
  const maps: MapBinding[] = [];
  for (const id of ids) {
    const directory = path.join(folder, id);
    const map = MapContent.parse(
      Bun.YAML.parse(await Bun.file(path.join(directory, "map.yml")).text()),
    );
    const scenario = MapScenario.parse(
      await Bun.file(path.join(directory, "scenario.json")).json(),
    );
    const admitted = mapScenarios.find((entry) => entry.map === id);
    validateScenario(scenario, map);
    if (map.id !== id || !isDeepStrictEqual(scenario, admitted))
      throw new Error(`Training map ${id} differs from its admitted identity`);
    maps.push({
      map: id,
      blocksSha256: map.blocksSha256,
      scenarioSha256: scenarioHash(scenario),
    });
  }
  const selected = diagnostic
    ? maps.filter((entry) => entry.map === "training-yard")
    : maps;
  return TrainingMaps.parse({
    schema: 1,
    kind: "rwf-training-maps",
    maps: selected,
  });
}

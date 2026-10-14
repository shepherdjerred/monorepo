import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  MapContent,
  MapScenario,
  sourceScenario,
  validateScenario,
} from "#learning/maps/scenario.ts";
import { closeScenario } from "#learning/maps/close-starts.ts";
import { removeShops } from "./shops.ts";

const root = path.resolve(import.meta.dir, "../../..");
const maps = path.join(root, "server/owned/plugins/TheStorm/rwf/maps");
const registryFile = path.join(
  root,
  "plugin/modules/rwfbots/src/main/resources/rwf-map-scenarios.json",
);
const trainingFile = path.join(
  root,
  "tools/learning/maps/training-scenarios.json",
);
const Registry = z.object({
  schema: z.literal(1),
  kind: z.string(),
  scenarios: z.array(MapScenario),
});
const registry = Registry.parse(await Bun.file(registryFile).json());
const training = Registry.parse(await Bun.file(trainingFile).json());
const mapTool = path.join(
  root,
  "plugin/tools/rwfmap/build/install/rwfmap/bin/rwfmap",
);
async function tool(action: string, directory: string) {
  const child = Bun.spawn(["mise", "exec", "--", mapTool, action, directory], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`${action} failed for ${directory}: ${stderr}`);
  return stdout;
}
let removed = 0;
const listing = await readdir(maps, { withFileTypes: true });
for (const entry of listing
  .filter((candidate) => candidate.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const folder = path.join(maps, entry.name);
  const count = await removeShops(folder);
  removed += count;
  const map = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
  );
  if (map.id !== entry.name)
    throw new Error("Installed map folder identity differs");
  if (count > 0) await tool("bake", folder);
  await tool("verify-details", folder);
  await tool("verify", folder);
  const existing = registry.scenarios.find(
    (scenario) => scenario.map === map.id,
  );
  const scenario =
    existing === undefined
      ? sourceScenario(map)
      : MapScenario.parse({ ...existing, mapSha256: map.blocksSha256 });
  validateScenario(scenario, map);
  await Bun.write(
    path.join(folder, "scenario.json"),
    JSON.stringify(scenario, null, 2) + "\n",
  );
  if (existing === undefined) registry.scenarios.push(scenario);
  else Object.assign(existing, scenario);
  const previous = training.scenarios.find(
    (candidate) => candidate.map === map.id,
  );
  if (previous === undefined) {
    const raw: unknown = JSON.parse(await tool("close-starts", folder));
    training.scenarios.push(closeScenario(map, raw));
  } else {
    previous.mapSha256 = map.blocksSha256;
    validateScenario(previous, map);
  }
  console.warn(
    `${map.id}: removed ${count.toString()} shops, terrain/payload/nav verified, source and training scenarios bound`,
  );
}
for (const [file, value] of [
  [registryFile, registry],
  [trainingFile, training],
] as const) {
  value.scenarios.sort((a, b) => a.map.localeCompare(b.map));
  await Bun.write(file, JSON.stringify(value, null, 2) + "\n");
}
console.warn(
  `Removed ${removed.toString()} legacy shops; registered ${registry.scenarios.length.toString()} maps.`,
);

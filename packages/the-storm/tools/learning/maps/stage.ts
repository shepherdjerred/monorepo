import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  MapContent,
  MapScenario,
  scenarioFor,
  validateScenario,
  type MapScenario as Scenario,
} from "./scenario.ts";

/** Remap just the disposable match's roster; region and schematic identity stay original. */
export function controlledMap(raw: unknown, scenario: Scenario): MapContent {
  const map = MapContent.parse(raw);
  validateScenario(scenario, map);
  return MapContent.parse({
    ...map,
    teams: scenario.spawns.map((spawn) => {
      const source = map.teams.find((team) => team.color === spawn.sourceTeam);
      if (source === undefined) throw new Error("Missing selected source team");
      return { color: spawn.team.toUpperCase(), spawns: source.spawns };
    }),
    bombs: map.bombs.flatMap((bomb) => {
      const side = scenario.spawns.find(
        (spawn) => spawn.sourceTeam === bomb.team,
      );
      return side === undefined
        ? []
        : [{ ...bomb, team: side.team.toUpperCase() }];
    }),
  });
}

/** Private owned-content copy for one fixed map; it cannot change ordinary live rotation. */
export async function stageMap(
  source: string,
  output: string,
  mapId: string,
  options: { duel: boolean; mapTool: string },
) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(mapId))
    throw new Error("Invalid map selection");
  const folder = path.join(source, "rwf/maps", mapId);
  const map = MapContent.parse(
    Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
  );
  if (map.id !== mapId)
    throw new Error("Map selection differs from folder identity");
  const scenario = MapScenario.parse(
    await Bun.file(path.join(folder, "scenario.json")).json(),
  );
  validateScenario(scenario, map);
  if (!isDeepStrictEqual(scenario, scenarioFor(mapId)))
    throw new Error("Owned scenario differs from its neutral registry");
  await mkdir(output, { recursive: false, mode: 0o700 });
  const content = path.join(output, "TheStorm");
  await mkdir(content);
  for (const entry of await readdir(source)) {
    if (entry !== "rwf")
      await cp(path.join(source, entry), path.join(content, entry), {
        recursive: true,
      });
  }
  await cp(
    path.join(path.dirname(source), "Citizens"),
    path.join(output, "Citizens"),
    { recursive: true },
  );
  const rwf = path.join(content, "rwf");
  await mkdir(rwf);
  for (const entry of await readdir(path.join(source, "rwf"))) {
    if (entry !== "maps")
      await cp(path.join(source, "rwf", entry), path.join(rwf, entry), {
        recursive: true,
      });
  }
  const selected = path.join(rwf, "maps", mapId);
  await cp(folder, selected, { recursive: true });
  if (options.duel) {
    await Bun.write(
      path.join(selected, "map.yml"),
      Bun.YAML.stringify(controlledMap(map, scenario)),
    );
    await Bun.write(
      path.join(rwf, "duel-scenario.json"),
      JSON.stringify(scenario, null, 2) + "\n",
    );
    // Original four-team goal fields must not survive inside a disposable two-team match.
    for (const action of ["bake", "verify"]) {
      const log = path.join(output, `${action}.log`);
      const child = Bun.spawn(
        ["mise", "exec", "--", options.mapTool, action, selected],
        {
          stdout: Bun.file(log),
          stderr: "pipe",
        },
      );
      const stderr = await new Response(child.stderr).text();
      if ((await child.exited) !== 0)
        throw new Error(`Controlled map ${action} failed: ${stderr}`);
    }
  }
  return { content, scenario, selected };
}

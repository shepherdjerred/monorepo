import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { MapContent } from "#learning/maps/scenario.ts";
import { closeScenario } from "#learning/maps/close-starts.ts";
import { freezeInputs } from "./inputs.ts";
import { root } from "./paper.ts";

const args = parseArgs({
  strict: true,
  options: { maps: { type: "string" }, output: { type: "string" } },
});
const required = (value: unknown) =>
  path.resolve(z.string().min(1).parse(value));
const source = required(args.values.maps);
const output = required(args.values.output);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const inputs = await freezeInputs(root, output);
const maps = path.join(output, "maps");
await mkdir(maps);
const listing = await readdir(source, { withFileTypes: true });
const entries = listing
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
if (entries.length === 0) throw new Error("No original maps to author");
const scenarios = [];
const results: { map: string; status: string; reason?: string }[] = [];
for (const entry of entries) {
  try {
    await inputs.check();
    const folder = path.join(maps, entry.name);
    await cp(path.join(source, entry.name), folder, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const map = MapContent.parse(
      Bun.YAML.parse(await Bun.file(path.join(folder, "map.yml")).text()),
    );
    if (map.id !== entry.name)
      throw new Error("Original map folder identity differs");
    const child = Bun.spawn(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        "close-starts",
        folder,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await Bun.write(path.join(output, `${map.id}.stdout`), stdout);
    await Bun.write(path.join(output, `${map.id}.stderr`), stderr);
    if (code !== 0)
      throw new Error(
        `Offline close-start selection failed (${code.toString()}): ${stderr}`,
      );
    const raw: unknown = JSON.parse(stdout);
    const scenario = closeScenario(map, raw);
    const target = folder;
    await Bun.write(
      path.join(target, "close-starts.json"),
      JSON.stringify(raw, null, 2) + "\n",
    );
    await Bun.write(
      path.join(target, "scenario.json"),
      JSON.stringify(scenario, null, 2) + "\n",
    );
    scenarios.push(scenario);
    results.push({
      map: map.id,
      status: "offline-authored-awaiting-native-admission",
    });
    console.warn(`Close starts authored: ${map.id}`);
  } catch (error) {
    results.push({
      map: entry.name,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.warn(`Close starts failed: ${entry.name}`);
  }
  await Bun.write(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
await inputs.check();
await Bun.write(
  path.join(output, "scenarios.json"),
  JSON.stringify({ schema: 1, kind: "rwf-map-scenarios", scenarios }, null, 2) +
    "\n",
);
if (results.some((result) => result.status === "failed"))
  throw new Error(
    "Close-start catalog is incomplete; retained all failures. No live or admitted training content changed.",
  );

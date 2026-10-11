import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { MapContent, sourceScenario } from "#learning/maps/scenario.ts";
import { freezeInputs } from "./inputs.ts";
import { root } from "./paper.ts";

const args = parseArgs({
  strict: true,
  options: {
    import: { type: "string", multiple: true },
    output: { type: "string" },
    details: { type: "string" },
  },
});
const imports = z
  .array(z.string().min(1))
  .min(1)
  .parse(args.values.import)
  .map((directory) => path.resolve(directory));
const output = path.resolve(z.string().min(1).parse(args.values.output));
const details = path.resolve(z.string().min(1).parse(args.values.details));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });

async function run(argv: string[], log: string) {
  const child = Bun.spawn(argv, {
    cwd: root,
    stdout: Bun.file(log),
    stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  await Bun.write(`${log}.stderr`, stderr);
  if ((await child.exited) !== 0)
    throw new Error(`Offline map command failed; see ${log}.stderr`);
}

await run(
  [
    "mise",
    "exec",
    "--",
    "gradle",
    "-p",
    "plugin",
    ":dist:assemble",
    ":rwfmap:installDist",
    "--console=plain",
  ],
  path.join(output, "build.log"),
);
const inputs = await freezeInputs(root, output);
const SourceSet = z.strictObject({
  schema: z.literal(1),
  archives: z
    .array(
      z.strictObject({
        archive: z.string().min(1),
        id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
        index: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
const sets = await Promise.all(
  imports.map(async (directory) =>
    SourceSet.parse(
      await Bun.file(path.join(directory, "source-set.json")).json(),
    ),
  ),
);
const original = sets[0];
if (
  original === undefined ||
  sets.some((set) => JSON.stringify(set) !== JSON.stringify(original))
)
  throw new Error(
    "Conversion batches must bind the same original archive order and map IDs",
  );
if (
  new Set(original.archives.map((map) => map.id)).size !==
  original.archives.length
)
  throw new Error("Original map set repeats an ID");
await Bun.write(
  path.join(output, "source-set.json"),
  JSON.stringify(original, null, 2) + "\n",
);
const maps = path.join(output, "maps");
await mkdir(maps);
const results: { id: string; status: string; reason?: string }[] = [];
const scenarios: ReturnType<typeof sourceScenario>[] = [];
for (const entry of original.archives) {
  const sources: string[] = [];
  for (const imported of imports) {
    const folder = path.join(imported, entry.id, "content", entry.id);
    if (await Bun.file(path.join(folder, "source.json")).exists())
      sources.push(folder);
  }
  if (sources.length > 1)
    throw new Error(
      `Multiple native exports for ${entry.id}; select one conversion batch`,
    );
  const source = sources[0];
  if (source === undefined) {
    results.push({ id: entry.id, status: "missing-native-export" });
    continue;
  }
  const target = path.join(maps, entry.id);
  try {
    await inputs.check();
    await mkdir(target);
    for (const file of ["map.yml", "blocks.schem", "source.json"])
      await cp(path.join(source, file), path.join(target, file));
    await cp(
      path.join(details, entry.id, "details.json"),
      path.join(target, "details.json"),
    );
    await cp(
      path.join(details, entry.id, "provenance.json"),
      path.join(target, "details.provenance.json"),
    );
    const map = MapContent.parse(
      Bun.YAML.parse(await Bun.file(path.join(target, "map.yml")).text()),
    );
    if (map.id !== entry.id)
      throw new Error(
        "Map metadata differs from its original archive identity",
      );
    const scenario = sourceScenario(map);
    await Bun.write(
      path.join(target, "scenario.json"),
      JSON.stringify(scenario, null, 2) + "\n",
    );
    for (const action of ["verify-details", "bake", "verify"])
      await run(
        [
          "mise",
          "exec",
          "--",
          path.join(inputs.mapTool, "bin/rwfmap"),
          action,
          target,
        ],
        path.join(output, `${entry.id}-${action}.log`),
      );
    await inputs.check();
    const summary = z
      .object({ generatorVersion: z.number().int() })
      .parse(await Bun.file(path.join(target, "nav.summary.json")).json());
    await Bun.write(
      path.join(target, "bake.json"),
      JSON.stringify(
        {
          schema: 1,
          map: map.id,
          blocksSha256: map.blocksSha256,
          generatorVersion: summary.generatorVersion,
          producer: inputs.hashes,
          status: "offline-verified-awaiting-native-acceptance",
        },
        null,
        2,
      ) + "\n",
    );
    scenarios.push(scenario);
    results.push({
      id: entry.id,
      status: "offline-verified-awaiting-native-acceptance",
    });
    console.warn(`Offline verified: ${entry.id}`);
  } catch (error) {
    results.push({
      id: entry.id,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    console.warn(`Offline verification failed: ${entry.id}`);
  }
  await Bun.write(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
await Bun.write(
  path.join(output, "results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
await Bun.write(
  path.join(output, "scenarios.json"),
  JSON.stringify({ schema: 1, kind: "rwf-map-scenarios", scenarios }, null, 2) +
    "\n",
);
if (
  results.some(
    (map) => map.status === "failed" || map.status === "missing-native-export",
  )
)
  throw new Error(
    "Map set is incomplete; see results.json and per-map logs. No live content was installed.",
  );

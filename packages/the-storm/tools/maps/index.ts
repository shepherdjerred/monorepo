import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import { paper, serverImage } from "@shepherdjerred/mc-harness/pins.ts";
import { thirdPartyPlugins } from "#e2e/harness/pins.ts";
import { legacyMap, mapContent, mapId, RemovedData } from "./legacy.ts";
import { exportTerrain, root } from "./paper.ts";
import { freezeInputs } from "./inputs.ts";
import { repairMetadata, Repairs } from "./repairs.ts";
import { exportDetails } from "./details-paper.ts";

const args = parseArgs({
  strict: true,
  options: {
    source: {
      type: "string",
      default: path.join(os.homedir(), "Downloads/Search and Destroy"),
    },
    output: { type: "string" },
    map: { type: "string", multiple: true },
    repairs: { type: "string" },
  },
});
const source = path.resolve(args.values.source);
const output = path.resolve(z.string().min(1).parse(args.values.output));
const repairs =
  args.values.repairs === undefined
    ? undefined
    : Repairs.parse(await Bun.file(args.values.repairs).json());
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false, mode: 0o700 });
const entries = await readdir(source);
const archives = entries.filter((file) => file.endsWith(".zip")).sort();
if (archives.length === 0) throw new Error("No legacy map archives found");
if (new Set(archives.map((file) => mapId(file))).size !== archives.length)
  throw new Error("Duplicate map IDs");
for (const selected of args.values.map ?? []) {
  if (!archives.some((file) => mapId(file) === selected))
    throw new Error(`Unknown source map: ${selected}`);
}

async function command(argv: string[], log: string) {
  const process = Bun.spawn(argv, {
    cwd: root,
    stdout: Bun.file(log),
    stderr: "pipe",
  });
  const stderr = await new Response(process.stderr).text();
  if ((await process.exited) !== 0)
    throw new Error(`Map tool failed; see ${log}\n${stderr}`);
}

await command(
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
await Bun.write(
  path.join(output, "source-set.json"),
  JSON.stringify(
    {
      schema: 1,
      archives: archives.map((archive, index) => ({
        archive,
        id: mapId(archive),
        index,
      })),
    },
    null,
    2,
  ) + "\n",
);
const extractor = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.array(z.string()),
  expandedBytes: z.number().int().positive(),
  savedChunks: z
    .array(z.strictObject({ x: z.number().int(), z: z.number().int() }))
    .min(1),
});
const failures: { id: string; error: string }[] = [];
for (const [index, archive] of archives.entries()) {
  const id = mapId(archive);
  if (args.values.map !== undefined && !args.values.map.includes(id)) continue;
  const directory = path.join(output, id);
  try {
    const inspect = Bun.spawn(
      [
        "python3",
        path.join(import.meta.dirname, "extract.py"),
        "--archive",
        path.join(source, archive),
        "--output",
        directory,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(inspect.stdout).text(),
      new Response(inspect.stderr).text(),
      inspect.exited,
    ]);
    if (exit !== 0) throw new Error(`Archive inspection failed: ${stderr}`);
    const original = extractor.parse(JSON.parse(stdout));
    const sourceText = await Bun.file(
      path.join(directory, "config.yml"),
    ).text();
    const repaired =
      repairs === undefined
        ? { text: sourceText, repair: null }
        : repairMetadata(sourceText, id, original.sha256, repairs);
    const map = legacyMap(repaired.text);
    if (repaired.repair !== null)
      await Bun.write(
        path.join(directory, "repaired-config.yml"),
        repaired.text,
      );
    console.warn(`Converting ${id} (${map.teams.length.toString()} teams)`);
    await Bun.write(
      path.join(directory, "source-chunks.json"),
      JSON.stringify(original.savedChunks),
    );
    await inputs.check();
    const terrain = await exportTerrain(directory, map, inputs);
    await inputs.check();
    const folder = path.join(directory, "content", id);
    await mkdir(folder, { recursive: true });
    await Bun.write(
      path.join(folder, "map.yml"),
      Bun.YAML.stringify(mapContent(id, index, map, terrain)),
    );
    await Bun.write(
      path.join(folder, "blocks.schem"),
      Bun.file(path.join(directory, "blocks.schem")),
    );
    const provenance = {
      schema: 1,
      id,
      archive,
      original,
      source: map.source,
      terrain,
      repair: repaired.repair,
      index,
      producer: inputs.hashes,
      translation: mapContent(id, index, map, terrain).region,
      runtime: {
        paper: {
          version: paper.version,
          build: paper.build,
          sha256: paper.sha256,
        },
        serverImage,
        plugins: thirdPartyPlugins.map(({ name, version, sha256 }) => ({
          name,
          version,
          sha256,
        })),
      },
      status: "converted-awaiting-navigation-and-native-acceptance",
    };
    await Bun.write(
      path.join(directory, "import.json"),
      JSON.stringify(provenance, null, 2) + "\n",
    );
    const removedData = RemovedData.parse(
      await Bun.file(path.join(directory, "removed-data.json")).json(),
    );
    if (removedData.length !== terrain.removedData)
      throw new Error("Removed entity-data count disagrees with native export");
    await Bun.write(
      path.join(folder, "source.json"),
      JSON.stringify({ ...provenance, removedData }, null, 2) + "\n",
    );
    const detailsOutput = path.join(directory, "details-export");
    await mkdir(detailsOutput);
    const details = await exportDetails(
      directory,
      detailsOutput,
      {
        map: mapContent(id, index, map, terrain),
        originalMin: { x: map.bounds.minX, z: map.bounds.minZ },
      },
      inputs,
    );
    await inputs.check();
    await Bun.write(
      path.join(folder, "details.json"),
      Bun.file(path.join(detailsOutput, "details.json")),
    );
    await Bun.write(
      path.join(folder, "details.provenance.json"),
      JSON.stringify(
        {
          schema: 1,
          id,
          blocksSha256: terrain.blocksSha256,
          detailsSha256: new Bun.CryptoHasher("sha256")
            .update(
              await Bun.file(path.join(folder, "details.json")).arrayBuffer(),
            )
            .digest("hex"),
          policy:
            "preserve-inventories-and-literal-sign-text-strip-other-payloads",
          producer: inputs.hashes,
          result: details,
        },
        null,
        2,
      ) + "\n",
    );
    await command(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        "verify-details",
        folder,
      ],
      path.join(directory, "verify-details.log"),
    );
    await command(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        "bake",
        folder,
      ],
      path.join(directory, "bake.log"),
    );
    await command(
      [
        "mise",
        "exec",
        "--",
        path.join(inputs.mapTool, "bin/rwfmap"),
        "verify",
        folder,
      ],
      path.join(directory, "verify.log"),
    );
    console.warn(`Converted and navigation-verified ${id}: ${folder}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ id, error: message });
    console.warn(`Import failed for ${id}: ${message}`);
    await Bun.write(
      path.join(output, "failures.json"),
      JSON.stringify(failures, null, 2) + "\n",
    );
  }
}
if (failures.length > 0)
  throw new Error(
    `${failures.length.toString()} maps failed import; originals preserved`,
  );

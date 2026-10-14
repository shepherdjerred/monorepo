import path from "node:path";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z as schema } from "zod";
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  Renderer,
  encodePng,
  assertTexturesPresent,
  withoutSky,
} from "@shepherdjerred/mc-build/render/index.ts";
import { terrainHash } from "./author.ts";

export const galleries = [
  ["duelist", "knight", "ravager", "acrobat", "alchemist", "scavenger"],
  ["arbalist", "volley", "marksman", "windrunner", "harpooner", "fletcher"],
  [
    "lancer",
    "maceguard",
    "quartermaster",
    "warden",
    "smokescreen",
    "tactician",
  ],
];
export async function lobbyWithAnnex() {
  const source = path.join(import.meta.dir, "lobby");
  const original = await readSchematic(
    new Uint8Array(
      await Bun.file(path.join(source, "base.schem")).arrayBuffer(),
    ),
  );
  const annex = await compileProgram({
    program: path.join(source, "annex.ts"),
    seed: 20_261_013,
    anchor: { x: 108, y: 64, z: 0 },
    site: null,
  });
  const grid = new BlockGrid({ x: 178, y: 36, z: 100 });
  original.grid.forEach((x, y, z, state) => {
    grid.set(x, y, z, state);
  });
  annex.grid.forEach((x, y, z, state) => {
    grid.set(x + 108, y, z, state);
  });
  // Documented door footprints are the only edits to the original courtyard.
  for (const z of [20, 76])
    for (let dz = 0; dz < 5; dz++) {
      grid.set(106, 6, z + dz, "minecraft:air");
      grid.set(107, 5, z + dz, "minecraft:polished_andesite");
    }
  return { grid, original, annex };
}

if (import.meta.main) {
  const args = parseArgs({
    strict: true,
    options: {
      iteration: { type: "string" },
      export: { type: "boolean", default: false },
    },
  });
  const iteration = schema
    .string()
    .regex(/^[a-z0-9-]+$/u)
    .parse(args.values.iteration);
  const { grid, original, annex } = await lobbyWithAnnex();
  const registry = await loadRegistry();
  const report = lintGrid(annex.grid, { registry });
  const evidence = path.resolve(
    import.meta.dir,
    "../../.cache/authored-lobby",
    iteration,
  );
  await mkdir(evidence, { recursive: true });
  await Bun.write(
    path.join(evidence, "lint.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const renderer = new Renderer(await ensureAssets());
  await Bun.write(
    path.join(evidence, "contact.png"),
    await encodePng(
      await renderer.sheet(withoutSky(grid), {
        title: "War Room - Armory Annex",
        subtitle: iteration,
        tile: 640,
      }),
    ),
  );
  const interior = new BlockGrid({ x: 70, y: 11, z: 100 });
  interior.forEach((x, y, z) => {
    interior.set(x, y, z, annex.grid.get(x, y, z));
  });
  await Bun.write(
    path.join(evidence, "interior.png"),
    await encodePng(
      await renderer.sheet(withoutSky(interior), {
        title: "Three armory galleries",
        subtitle: "Classic / Ranged / Tactical - eight bays each",
        tile: 640,
      }),
    ),
  );
  assertTexturesPresent(renderer, "War Room annex");
  if (!report.ok) throw new Error(`Annex lint failed; inspect ${evidence}`);
  if (args.values.export) {
    const target = path.resolve(
      import.meta.dir,
      "../../server/owned/plugins/TheStorm/rwf/lobby",
    );
    const bytes = writeSchematic(grid, registry.dataVersion);
    const decoded = await readSchematic(bytes);
    const hash = terrainHash(decoded.grid);
    const base = schema
      .object({
        region: schema.object({ min: schema.unknown(), max: schema.unknown() }),
        alcoves: schema.array(schema.unknown()),
      })
      .loose()
      .parse(
        Bun.YAML.parse(
          await Bun.file(path.join(import.meta.dir, "lobby/base.yml")).text(),
        ),
      );
    const alcoves = galleries.flatMap((kits, room) =>
      kits.map((kit, slot) => {
        const x = 128 + (slot % 4) * 8 + 0.5;
        const z = 12 + room * 27 + (slot < 4 ? 4 : 18) + 0.5;
        return {
          kit,
          display: { x, y: 72.25, z },
          stand: {
            x,
            y: 70,
            z: z + (slot < 4 ? 3 : -3),
            yaw: slot < 4 ? 180 : 0,
            pitch: 0,
          },
        };
      }),
    );
    await Bun.write(path.join(target, "blocks.schem"), bytes);
    await Bun.write(
      path.join(target, "lobby.yml"),
      Bun.YAML.stringify({
        ...base,
        region: { min: base.region.min, max: { x: 177, y: 99, z: 99 } },
        alcoves: [...base.alcoves, ...alcoves],
        blocksSha256: hash,
      }),
    );
    await Bun.write(
      path.join(target, "source.json"),
      JSON.stringify(
        {
          schema: 1,
          kind: "preserved-lobby-with-authored-annex",
          program: "tools/maps/lobby/annex.ts",
          original: "tools/maps/lobby/base.schem",
          originalMetadata: "tools/maps/lobby/base.yml",
          originalBlocksSha256: terrainHash(original.grid),
          blocksSha256: hash,
          seed: 20_261_013,
          dataVersion: registry.dataVersion,
          doorwayEdits: [20, 76].map((z) => ({
            min: { x: 106, y: 69, z },
            max: { x: 107, y: 70, z: z + 4 },
          })),
          originalAlcoves: 33,
          newAlcoves: 18,
          totalCapacity: 60,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.warn(
    `Annex: ${report.errors.toString()} errors / ${report.warnings.toString()} warnings; ${evidence}`,
  );
}

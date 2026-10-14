import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { type BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
  withoutSky,
} from "@shepherdjerred/mc-build/render/index.ts";

const Point = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});
export const AuthoredMap = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  name: z.string().min(1),
  description: z.string().min(1),
  seed: z.number().int(),
  anchor: Point,
  size: Point.refine((size) => size.x > 0 && size.y > 0 && size.z > 0),
  bombs: z.array(Point).length(2),
  nukes: z.array(Point),
  spawnY: z.number().int(),
});

/** The runtime terrain identity, matching Schematic.sha256's palette and big-endian indices. */
export function terrainHash(grid: BlockGrid): string {
  const hash = createHash("sha256");
  hash.update(
    `sponge-v3\n${grid.size.x.toString()} ${grid.size.y.toString()} ${grid.size.z.toString()}\n`,
  );
  grid.palette.forEach((state, index) =>
    hash.update(`${index.toString()}\t${state}\n`),
  );
  const data = Buffer.alloc(grid.volume * 4);
  grid.data.forEach((index, offset) => data.writeUInt32BE(index, offset * 4));
  hash.update(data);
  return hash.digest("hex");
}

async function author(id: string, iteration: string, publish: boolean) {
  const sources = path.join(import.meta.dir, "authored");
  const map = AuthoredMap.parse(
    await Bun.file(path.join(sources, `${id}.json`)).json(),
  );
  if (map.id !== id) throw new Error("Authored filename and identity differ");
  const program = path.join(sources, `${id}.ts`);
  const compiled = await compileProgram({
    program,
    seed: map.seed,
    anchor: map.anchor,
    site: null,
    timeoutMs: 120_000,
  });
  if (
    compiled.min.x !== 0 ||
    compiled.min.y !== 0 ||
    compiled.min.z !== 0 ||
    JSON.stringify(compiled.grid.size) !== JSON.stringify(map.size)
  )
    throw new Error(
      `${id}: program exceeds the declared canvas or misses a boundary`,
    );
  const registry = await loadRegistry();
  const report = lintGrid(compiled.grid, { registry });
  const evidence = path.resolve(
    import.meta.dir,
    "../../.cache/authored-maps",
    id,
    iteration,
  );
  await mkdir(evidence, { recursive: true });
  await Bun.write(
    path.join(evidence, "lint.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  const schematic = writeSchematic(compiled.grid, registry.dataVersion);
  const decoded = await readSchematic(schematic);
  const hash = terrainHash(decoded.grid);
  await Bun.write(path.join(evidence, "blocks.schem"), schematic);
  const renderer = new Renderer(await ensureAssets());
  const framed = withoutSky(compiled.grid);
  await Bun.write(
    path.join(evidence, "contact.png"),
    await encodePng(
      await renderer.sheet(framed, {
        title: map.name,
        subtitle: `${iteration}: routes, silhouette, materials`,
        tile: 640,
      }),
    ),
  );
  await Bun.write(
    path.join(evidence, "hero.png"),
    await encodePng(await renderer.hero(framed)),
  );
  assertTexturesPresent(renderer, map.name);
  if (!report.ok)
    throw new Error(`${id}: lint failed; inspect ${evidence}/lint.json`);
  if (publish) {
    const target = path.resolve(
      import.meta.dir,
      "../../server/owned/plugins/TheStorm/rwf/maps",
      id,
    );
    await mkdir(target, { recursive: true });
    const worldPoint = (point: z.infer<typeof Point>) => ({
      x: map.anchor.x + point.x,
      y: map.anchor.y + point.y,
      z: map.anchor.z + point.z,
    });
    const spawnZ = Math.floor(map.size.z / 2);
    const teams = ["RED", "BLUE"].map((color, index) => ({
      color,
      spawns: [0, 1].flatMap((row) =>
        [-6, -4, 4, 6].map((dz) => ({
          x:
            map.anchor.x +
            (index === 0 ? 5 + row * 2 : map.size.x - 6 - row * 2) +
            0.5,
          y: map.anchor.y + map.spawnY,
          z: map.anchor.z + spawnZ + dz + 0.5,
          yaw: index === 0 ? 270 : 90,
          pitch: 0,
        })),
      ),
    }));
    const metadata = {
      id,
      name: map.name,
      author: "The Storm",
      description: map.description,
      region: {
        min: map.anchor,
        max: worldPoint({
          x: map.size.x - 1,
          y: map.size.y - 1,
          z: map.size.z - 1,
        }),
      },
      spectator: {
        x: map.anchor.x + map.size.x / 2 + 0.5,
        y: map.anchor.y + 43,
        z: map.anchor.z + map.size.z / 2 + 0.5,
        yaw: 0,
        pitch: 65,
      },
      teams,
      bombs: map.bombs.map((at, index) => ({
        id: index === 0 ? "red-1" : "blue-1",
        team: index === 0 ? "RED" : "BLUE",
        at: worldPoint(at),
      })),
      nukes: map.nukes.map((at, index) => ({
        id: `nuke-${(index + 1).toString()}`,
        at: worldPoint(at),
      })),
      blocksSha256: hash,
    };
    await Bun.write(path.join(target, "blocks.schem"), schematic);
    await Bun.write(
      path.join(target, "map.yml"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    await Bun.write(
      path.join(target, "details.json"),
      JSON.stringify(
        { version: 1, blocksSha256: hash, containers: [], signs: [] },
        null,
        2,
      ) + "\n",
    );
    await Bun.write(
      path.join(target, "source.json"),
      JSON.stringify(
        {
          schema: 1,
          kind: "original-mc-build-program",
          program: `tools/maps/authored/${id}.ts`,
          metadata: `tools/maps/authored/${id}.json`,
          seed: map.seed,
          dataVersion: registry.dataVersion,
          blocksSha256: hash,
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.warn(
    `${id}: ${hash}, lint ${report.errors.toString()} errors/${report.warnings.toString()} warnings, evidence ${evidence}`,
  );
}

if (import.meta.main) {
  const args = parseArgs({
    strict: true,
    options: {
      id: { type: "string", multiple: true },
      iteration: { type: "string" },
      export: { type: "boolean", default: false },
    },
  });
  const ids = z.array(AuthoredMap.shape.id).min(1).parse(args.values.id);
  const iteration = z
    .string()
    .regex(/^[a-z0-9-]+$/u)
    .parse(args.values.iteration);
  for (const id of ids) await author(id, iteration, args.values.export);
}

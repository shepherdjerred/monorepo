/**
 * Renders a build program (`*.ts`) or schematic (`*.schem`) to a contact
 * sheet PNG: bun run scripts/render.ts <input> <out.png> [--seed n] [--hero <hero.png>]
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { compileProgram } from "#src/compile/runner.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import { readSchematic } from "#src/core/schem.ts";
import { ensureAssets } from "#src/render/assets.ts";
import { encodePng, Renderer } from "#src/render/index.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string", default: "1" },
    hero: { type: "string" },
  },
  allowPositionals: true,
});
const [input, out] = positionals;
if (input === undefined || out === undefined) {
  console.error(
    "usage: bun run scripts/render.ts <build.ts|file.schem> <out.png> [--seed n] [--hero <hero.png>]",
  );
  process.exit(1);
}

async function load(file: string): Promise<BlockGrid> {
  if (file.endsWith(".schem")) {
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
    const schematic = await readSchematic(bytes);
    return schematic.grid;
  }
  const compiled = await compileProgram({
    program: file,
    seed: Number(values.seed),
    anchor: { x: 0, y: 0, z: 0 },
    site: null,
  });
  return compiled.grid;
}

const grid = await load(input);
const renderer = new Renderer(await ensureAssets());
const started = performance.now();
const image = await renderer.sheet(grid, {
  title: path.basename(input),
  subtitle: "MC-BUILD PREVIEW",
});
await Bun.write(out, await encodePng(image));
if (values.hero !== undefined) {
  await Bun.write(values.hero, await encodePng(await renderer.hero(grid)));
  process.stdout.write(`wrote ${values.hero}\n`);
}
process.stdout.write(
  `wrote ${out} (${image.width.toString()}×${image.height.toString()}) in ${Math.round(performance.now() - started).toString()} ms\n`,
);
if (renderer.missingTextures.length > 0) {
  console.error(`missing textures: ${renderer.missingTextures.join(", ")}`);
}

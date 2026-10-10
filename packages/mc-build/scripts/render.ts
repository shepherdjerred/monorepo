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
import {
  assertTexturesPresent,
  encodePng,
  Renderer,
} from "#src/render/index.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string", default: "1" },
    hero: { type: "string" },
    "judge-sheet": { type: "string" },
    kind: { type: "string", default: "micro" },
    label: { type: "string", default: "A" },
  },
  allowPositionals: true,
});
const [input, out] = positionals;
const kind = values.kind;
if (
  input === undefined ||
  out === undefined ||
  (kind !== "micro" && kind !== "map")
) {
  console.error(
    "usage: bun run scripts/render.ts <build.ts|file.schem> <out.png> [--seed n] [--hero <hero.png>] [--judge-sheet <sheet.png> --kind micro|map --label A]",
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
const hero = values.hero === undefined ? null : await renderer.hero(grid);
const sheet =
  values["judge-sheet"] === undefined
    ? null
    : await renderer.judgeSheet(grid, { kind, label: values.label });
// Nothing is written when a texture was missing: a grader or judge reading
// the files must never see the fallback checker as the build's own look.
assertTexturesPresent(renderer, `render of ${path.basename(input)}`);
await Bun.write(out, await encodePng(image));
if (hero !== null && values.hero !== undefined) {
  await Bun.write(values.hero, await encodePng(hero));
  process.stdout.write(`wrote ${values.hero}\n`);
}
if (sheet !== null && values["judge-sheet"] !== undefined) {
  await Bun.write(values["judge-sheet"], await encodePng(sheet));
  process.stdout.write(`wrote ${values["judge-sheet"]} (${kind})\n`);
}
process.stdout.write(
  `wrote ${out} (${image.width.toString()}×${image.height.toString()}) in ${Math.round(performance.now() - started).toString()} ms\n`,
);

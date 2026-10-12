/** A grid from a `.schem` file or a compiled build program, for the render scripts. */
import { compileProgram } from "#src/compile/runner.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import { readSchematic } from "#src/core/schem.ts";

export async function loadGrid(file: string, seed: number): Promise<BlockGrid> {
  if (file.endsWith(".schem")) {
    const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
    const schematic = await readSchematic(bytes);
    return schematic.grid;
  }
  const compiled = await compileProgram({
    program: file,
    seed,
    anchor: { x: 0, y: 0, z: 0 },
    site: null,
  });
  return compiled.grid;
}

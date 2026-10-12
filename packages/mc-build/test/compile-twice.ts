import { compileProgram } from "#src/compile/runner.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import { lintGrid, type Finding } from "#src/lint/lint.ts";
import type { BlockRegistry } from "#src/registry/registry.ts";

/**
 * Compiles a program twice with the same seed and lints the first result:
 * `drift` is the cell difference between the runs (0 when deterministic).
 */
export async function compileTwice(
  program: string,
  seed: number,
  registry: BlockRegistry,
): Promise<{ grid: BlockGrid; drift: number; findings: Finding[] }> {
  const options = {
    program,
    seed,
    anchor: { x: 0, y: 0, z: 0 },
    site: null,
  };
  const first = await compileProgram(options);
  const second = await compileProgram(options);
  return {
    grid: first.grid,
    drift: first.grid.diff(second.grid).count,
    findings: lintGrid(first.grid, { registry }).findings,
  };
}

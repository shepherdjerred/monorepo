/**
 * Compiles a build program (or a library entry) and prints its lint report:
 * bun run scripts/lint-program.ts <build.ts> [--seed n]
 */
import { parseArgs } from "node:util";
import { compileProgram } from "#src/compile/runner.ts";
import { lintGrid } from "#src/lint/lint.ts";
import { loadRegistry } from "#src/registry/registry.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { seed: { type: "string", default: "1" } },
  allowPositionals: true,
});
const [program] = positionals;
if (program === undefined) {
  console.error("usage: bun run scripts/lint-program.ts <build.ts> [--seed n]");
  process.exit(1);
}
const compiled = await compileProgram({
  program,
  seed: Number(values.seed),
  anchor: { x: 0, y: 0, z: 0 },
  site: null,
});
const report = lintGrid(compiled.grid, { registry: await loadRegistry() });
for (const finding of report.findings) {
  const at = finding.at
    .slice(0, 4)
    .map((p) => `${p.x.toString()},${p.y.toString()},${p.z.toString()}`)
    .join(" ");
  process.stdout.write(
    `${finding.severity} ${finding.code}: ${finding.message} @ ${at}\n`,
  );
}
process.stdout.write(
  `${report.errors.toString()} error(s), ${report.warnings.toString()} warning(s), ${report.stats.blocks.toString()} blocks\n`,
);
process.exitCode = report.errors > 0 ? 2 : 0;

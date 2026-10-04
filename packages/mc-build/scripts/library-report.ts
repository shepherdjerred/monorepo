/**
 * Compiles, lints and renders every library entry (or the slugs given):
 * bun run scripts/library-report.ts <outDir> [slug…]
 * Exits 2 when any entry has lint errors.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { compileProgram } from "#src/compile/runner.ts";
import { listLibrary } from "#src/library/library.ts";
import { lintGrid } from "#src/lint/lint.ts";
import { loadRegistry } from "#src/registry/registry.ts";
import { ensureAssets } from "#src/render/assets.ts";
import { encodePng, Renderer } from "#src/render/index.ts";

const [outDir, ...slugs] = Bun.argv.slice(2);
if (outDir === undefined) {
  console.error("usage: bun run scripts/library-report.ts <outDir> [slug…]");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
const registry = await loadRegistry();
const renderer = new Renderer(await ensureAssets());
let failed = false;
for (const entry of await listLibrary()) {
  if (slugs.length > 0 && !slugs.includes(entry.slug)) {
    continue;
  }
  const compiled = await compileProgram({
    program: entry.program,
    seed: 1,
    anchor: { x: 0, y: 0, z: 0 },
    site: null,
  });
  const report = lintGrid(compiled.grid, { registry });
  failed ||= report.errors > 0;
  const out = path.join(outDir, `${entry.slug}.png`);
  await Bun.write(
    out,
    await encodePng(
      await renderer.sheet(compiled.grid, {
        title: entry.meta.title,
        subtitle: `library/${entry.slug}`,
      }),
    ),
  );
  process.stdout.write(
    `${entry.slug}: ${report.errors.toString()} error(s), ${report.warnings.toString()} warning(s), ${compiled.grid
      .histogram()
      .reduce((sum, row) => sum + row.count, 0)
      .toString()} cells → ${out}\n`,
  );
  for (const finding of report.findings) {
    const at = finding.at
      .slice(0, 6)
      .map((p) => `${p.x.toString()},${p.y.toString()},${p.z.toString()}`)
      .join(" ");
    process.stdout.write(
      `  ${finding.severity} ${finding.code}: ${finding.message}${at === "" ? "" : ` @ ${at}`}\n`,
    );
  }
}
process.exitCode = failed ? 2 : 0;

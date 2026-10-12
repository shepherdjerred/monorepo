/**
 * Turns one promoted build (a schematic) into a bench entry: the judge sheet
 * as a small JPEG, offline lint, the grid hash, the repetition ratio, and the
 * metadata a leaderboard row needs. The sheet renderer is injected so tests
 * run without Mojang assets.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import {
  assertTexturesPresent,
  encodeJpeg,
  Renderer,
} from "@shepherdjerred/mc-build/render/index.ts";
import { repetitionRatio } from "@shepherdjerred/mc-build/lint/repetition.ts";
import type { BlockRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import type { JudgeRubric } from "#protocol/build.ts";
import {
  BENCH_FILES,
  EntryMetaSchema,
  sha256,
  type EntryMeta,
} from "#evals/bench/lib/entries.ts";

export type SheetRenderer = (
  grid: BlockGrid,
  rubric: JudgeRubric,
) => Promise<Uint8Array>;

/** The judge sheet of a grid as a JPEG, from the cached Mojang assets. */
export async function assetSheetRenderer(): Promise<SheetRenderer> {
  const renderer = new Renderer(await ensureAssets());
  return async (grid, rubric) => {
    const sheet = await renderer.judgeSheet(grid, { kind: rubric, label: "X" });
    assertTexturesPresent(renderer, `judge sheet (${rubric})`);
    return new Uint8Array(await encodeJpeg(sheet));
  };
}

export async function collectEntry(options: {
  schematic: Uint8Array;
  /**
   * The captured site the build was promoted over, when the grader kept one:
   * repetition is then measured on what changed, so a flat site's own layers
   * never count as copies. Anchors have no site and are measured whole.
   */
  site?: Uint8Array;
  registry: BlockRegistry;
  renderSheet: SheetRenderer;
  /** Where the entry is written (`history/<task>/<id>` or `anchors/<slug>`). */
  dir: string;
  /** Where the schematic is kept outside the repository; null skips the copy. */
  schematicOut: string | null;
  meta: Omit<
    EntryMeta,
    "lint" | "gridHash" | "size" | "blocks" | "repetition" | "schematic"
  >;
}): Promise<EntryMeta> {
  const { grid } = await readSchematic(options.schematic);
  const lint = lintGrid(grid, { registry: options.registry });
  const site =
    options.site === undefined ? null : await readSchematic(options.site);
  const repetition = repetitionRatio(
    grid,
    site === null ? {} : { baseline: site.grid },
  );
  const sheet = await options.renderSheet(grid, options.meta.rubric);
  await mkdir(options.dir, { recursive: true });
  await Bun.write(path.join(options.dir, BENCH_FILES.sheet), sheet);
  let schematic: EntryMeta["schematic"] = null;
  if (options.schematicOut !== null) {
    await mkdir(path.dirname(options.schematicOut), { recursive: true });
    await Bun.write(options.schematicOut, options.schematic);
    schematic = {
      path: options.schematicOut,
      sha256: sha256(options.schematic),
    };
  }
  const meta = EntryMetaSchema.parse({
    ...options.meta,
    lint: {
      errors: lint.errors,
      warnings: lint.warnings,
      codes: [
        ...new Set(lint.findings.map((finding) => finding.code)),
      ].toSorted(),
    },
    gridHash: gridHash(grid),
    size: grid.size,
    blocks: lint.stats.blocks,
    repetition: Number(repetition.ratio.toFixed(4)),
    schematic,
  });
  await Bun.write(
    path.join(options.dir, BENCH_FILES.meta),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  return meta;
}

/**
 * Derive responsive WebP renditions of the landing page's showcase PNGs.
 *
 * Runs before `astro dev` and `astro build`. Output lives in a gitignored
 * directory under `public/` and is a pure function of the committed PNGs, so
 * renditions that are already newer than their source are kept. The manifest
 * of what was written goes beside the showcase index under `src/data/`.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { getGeneratedScoutShowcaseAssetSrc } from "#src/data/scout-showcase.ts";
import {
  LANDING_SHOWCASE_IDS,
  SHOWCASE_VARIANT_MANIFEST,
  SHOWCASE_VARIANT_PUBLIC_DIR,
  SHOWCASE_VARIANT_WIDTHS,
  type ShowcaseVariantManifest,
} from "#src/data/scout-showcase-variants.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(packageRoot, "public");
const outputDir = path.join(publicRoot, SHOWCASE_VARIANT_PUBLIC_DIR);

async function isFresh(
  output: string,
  sourceMtimeMs: number,
): Promise<boolean> {
  try {
    return (await stat(output)).mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

await mkdir(outputDir, { recursive: true });
const manifest: ShowcaseVariantManifest = {};
let written = 0;

for (const id of LANDING_SHOWCASE_IDS) {
  const source = path.join(publicRoot, getGeneratedScoutShowcaseAssetSrc(id));
  const { mtimeMs } = await stat(source);
  const { width: sourceWidth } = await sharp(source).metadata();
  if (sourceWidth === undefined) {
    throw new Error(`Cannot read the width of ${source}`);
  }
  const widths = [
    ...new Set(
      SHOWCASE_VARIANT_WIDTHS.map((width) => Math.min(width, sourceWidth)),
    ),
  ];
  manifest[id] = [];
  for (const width of widths) {
    const fileName = `${id}-${width.toString()}.webp`;
    const output = path.join(outputDir, fileName);
    if (!(await isFresh(output, mtimeMs))) {
      await sharp(source)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 6 })
        .toFile(output);
      written += 1;
    }
    manifest[id].push({
      width,
      src: `${SHOWCASE_VARIANT_PUBLIC_DIR}/${fileName}`,
    });
  }
}

await writeFile(
  path.join(packageRoot, SHOWCASE_VARIANT_MANIFEST),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Showcase renditions ready (${written.toString()} written) in ${outputDir}`,
);

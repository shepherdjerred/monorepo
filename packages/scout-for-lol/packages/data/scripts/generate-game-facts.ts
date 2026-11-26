import { strict as assert } from "node:assert";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildAllGameFacts, gameFactFile } from "#src/game-facts/build.ts";
import { loadGameFactSources } from "#src/game-facts/sources.ts";

/**
 * Per-entity tooltip facts, generated from the committed Data Dragon snapshot
 * into `src/data-dragon/assets/facts/<kind>/<key>.json`. The design-system
 * asset emission serves that folder at
 * `/assets/scout/game/<patch>/facts/<kind>/<key>.json`.
 *
 * `--write` regenerates the folder; `--check` fails when it has drifted.
 */

const packageRoot = resolve(import.meta.dir, "..");
const factsRoot = resolve(packageRoot, "src/data-dragon/assets/facts");

const files = buildAllGameFacts(await loadGameFactSources()).map((fact) =>
  gameFactFile(fact),
);
const expected = new Map(files.map((file) => [file.path, file.content]));
assert.equal(expected.size, files.length, "Duplicate game fact paths");

async function existingPaths(): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: factsRoot })) {
    paths.push(`facts/${path.replaceAll("\\", "/")}`);
  }
  return paths.toSorted();
}

if (Bun.argv.includes("--write")) {
  await rm(factsRoot, { recursive: true, force: true });
  await Promise.all(
    files.map(async (file) => {
      const target = resolve(factsRoot, file.path.slice("facts/".length));
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, file.content);
    }),
  );
  console.log(`Wrote ${String(files.length)} game fact files`);
} else {
  const onDisk = await existingPaths();
  assert.deepEqual(
    onDisk,
    [...expected.keys()].toSorted(),
    "Game fact files drifted; run bun run generate:game-facts",
  );
  for (const file of files) {
    assert.equal(
      await Bun.file(
        resolve(factsRoot, file.path.slice("facts/".length)),
      ).text(),
      file.content,
      `Game fact ${file.path} drifted; run bun run generate:game-facts`,
    );
  }
  console.log(`Verified ${String(files.length)} game fact files`);
}

import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { createArchivedAnimationExporter } from "./archived-animation-export.mjs";

const [sourceCacheArg, actorArg, cacheArg, dotnet = "dotnet"] =
  process.argv.slice(2);
if (!cacheArg || process.argv.length > 6)
  throw Error(
    "Usage: bun prepare-archived-animation-pack.mjs <approved-source-cache> <original-actor-folder> <archive-cache> [dotnet]",
  );
const { sourceCache, cache, out, work } = await createStaticPreparationOutput(
  sourceCacheArg,
  cacheArg,
  { prefix: "animation-pack-", directory: "actor" },
);
const actor = await realpath(actorArg);
if (out.startsWith(actor + path.sep))
  throw Error(
    "Isolated animation output must not be nested in source actor input",
  );
for (const file of new Bun.Glob("**/*").scanSync({
  cwd: actor,
  onlyFiles: true,
})) {
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await Bun.write(
    path.join(out, file),
    await Bun.file(path.join(actor, file)).bytes(),
  );
}
const exporter = await createArchivedAnimationExporter({
  sourceCache,
  cache,
  work,
  dotnet,
});
const result = await exporter(out);
console.log(
  JSON.stringify({ output: out, ...result, nativeFidelityAdmission: false }),
);

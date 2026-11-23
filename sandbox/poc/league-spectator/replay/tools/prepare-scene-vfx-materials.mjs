import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
const [sourceArg, nativeArg, cacheArg, pythonArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-vfx-materials.mjs <approved-source-cache> <closed-native-vfx-authority> <archive-cache> [python]",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "vfx-materials-", directory: "scene-vfx-materials" },
  ),
  child = Bun.spawn(
    [
      pythonArg ?? path.join(sourceCache, "research/venv/Scripts/python.exe"),
      fileURLToPath(new URL("prepare-scene-vfx-materials.py", import.meta.url)),
      path.join(sourceCache, "public/decoder-16.21-macos"),
      path.join(sourceCache, "research/LeagueofLegends-macos"),
      path.resolve(nativeArg),
      out,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
if ((await child.exited) !== 0)
  throw Error(
    "Complete original scene material preparation failed; no authority published",
  );

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";

const [sourceArg, fieldsArg, cacheArg, pythonArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-vfx-native.mjs <approved-source-cache> <closed-vfx-field-inputs> <archive-cache> [python]",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "vfx-native-", directory: "scene-vfx-native" },
  ),
  python =
    pythonArg ?? path.join(sourceCache, "research/venv/Scripts/python.exe"),
  child = Bun.spawn(
    [
      python,
      fileURLToPath(new URL("prepare-scene-vfx-native.py", import.meta.url)),
      path.join(sourceCache, "public/decoder-16.21-macos"),
      path.join(sourceCache, "research/LeagueofLegends-macos"),
      path.resolve(fieldsArg),
      out,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
if ((await child.exited) !== 0)
  throw Error(
    "Complete original scene VFX preparation failed; no authority published",
  );

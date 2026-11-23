import path from "node:path";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 } from "./archived-actor-sources.mjs";
import { writeOwnedCompressedSources } from "./owned-compressed-animation.mjs";

const [sourceCacheArg, actorFolderArg, outputCache, dotnet = "dotnet", mode, nativeControls] =
  process.argv.slice(2);
if (!outputCache || process.argv.length > 8 || (mode !== undefined && mode !== "--owned-compressed"))
  throw Error(
    "Usage: bun diagnose-archived-animations.mjs <approved-source-cache> <original-actor-folder> <output-cache> [dotnet]",
  );
const { sourceCache, work, out } = await createStaticPreparationOutput(
  sourceCacheArg,
  outputCache,
  { prefix: "animation-diagnostic-", directory: "animation-diagnostics" },
);
const build = path.join(work, "build");
await mkdir(build);
for (const file of ["Program.cs", "AnimationDiagnostics.csproj"])
  await Bun.write(
    path.join(build, file),
    await Bun.file(
      new URL(`animation-diagnostics/${file}`, import.meta.url),
    ).bytes(),
  );
const ownedSources = await writeOwnedCompressedSources(sourceCache, build);
await Bun.write(path.join(out, "owned-source-receipt.json"), JSON.stringify(ownedSources, null, 2));
async function run(args) {
  const child = Bun.spawn([dotnet, ...args], {
    cwd: tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw Error(`Animation diagnostics failed: ${stdout}\n${stderr}`);
  console.log(stdout.trim());
}
await run([
  "build",
  path.join(build, "AnimationDiagnostics.csproj"),
  `-p:ExporterDirectory=${path.join(sourceCache, "exporter-build/bin/Debug/net10.0")}`,
  "--ignore-failed-sources",
  "-v",
  "quiet",
]);
const actorFolder = path.resolve(actorFolderArg),
  output = path.join(out, "diagnostics.json");
await run([
  path.join(build, "bin/Debug/net10.0/AnimationDiagnostics.dll"),
  actorFolder,
  output,
  ...(mode ? [mode] : []),
  ...(nativeControls ? [`--native-controls=${path.resolve(nativeControls)}`] : []),
]);
const bytes = await Bun.file(output).bytes();
console.log(
  JSON.stringify({ output, sha256: actorSha256(bytes), actorFolder }),
);

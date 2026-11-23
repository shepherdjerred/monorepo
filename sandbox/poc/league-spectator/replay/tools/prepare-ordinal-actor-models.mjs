import path from "node:path";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-layout.mjs";
const [sourceArg, manifestArg, cacheArg, dotnet = "dotnet", filter] =
  process.argv.slice(2);
if (!cacheArg || (filter !== undefined && !filter.startsWith("--actor=")))
  throw Error(
    "Usage: bun prepare-ordinal-actor-models.mjs <approved-source-cache> <prepared-actor-manifest.json> <archive-cache> [dotnet] [--actor=key]",
  );
const manifestFile = path.resolve(manifestArg),
  input = path.dirname(manifestFile),
  manifestBytes = await Bun.file(manifestFile).bytes(),
  original = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
  );
if (
  original.schema !== 1 ||
  original.kind !== "archived-original-actor-assets" ||
  original.build !== "16.21.829.8620" ||
  original.protocol !== "20e09df23c66b85e" ||
  !Array.isArray(original.files)
)
  throw Error("Original source-bound actor package required");
const { sourceCache, out, work } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "ordinal-models-", directory: "latest-scene" },
  ),
  sources = {};
for (const file of [
  "prepare-ordinal-actor-models.mjs",
  "ordinal-model/Program.cs",
  "ordinal-model/OrdinalModelExporter.csproj",
  "map-scene-output.mjs",
  "ordinal-model-layout.mjs",
])
  sources[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
const selectedKey = filter?.slice("--actor=".length),
  all = { ...original.champions, ...original.worldAssets },
  selected = Object.fromEntries(
    Object.entries(all).filter(
      ([key]) => selectedKey === undefined || key === selectedKey,
    ),
  );
if (!Object.keys(selected).length)
  throw Error("Requested original actor is absent");
const replaced = new Set(Object.values(selected).map((asset) => asset.model)),
  inputs = [];
for (const entry of original.files) {
  sceneAnimationFilePath(entry.path);
  const bytes = await Bun.file(path.join(input, entry.path)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`Original actor package file differs: ${entry.path}`);
  inputs.push(entry);
  if (replaced.has(entry.path)) continue;
  await mkdir(path.dirname(path.join(out, entry.path)), { recursive: true });
  await Bun.write(path.join(out, entry.path), bytes);
}
const build = path.join(work, "model-export-build");
await mkdir(build);
for (const file of ["Program.cs", "OrdinalModelExporter.csproj"])
  await Bun.write(
    path.join(build, file),
    await Bun.file(new URL(`ordinal-model/${file}`, import.meta.url)).bytes(),
  );
const references = path.join(sourceCache, "exporter-build/bin/Debug/net10.0"),
  referenceHashes = {};
for (const file of new Bun.Glob("*.dll").scanSync({
  cwd: references,
  onlyFiles: true,
}))
  referenceHashes[file] = sha(
    await Bun.file(path.join(references, file)).bytes(),
  );
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
    throw Error(
      `Original ordinal model exporter failed(${code}): ${stdout}\n${stderr}`,
    );
  console.log(stdout.trim());
}
await run([
  "build",
  path.join(build, "OrdinalModelExporter.csproj"),
  `-p:ExporterDirectory=${references}`,
  "--ignore-failed-sources",
  "-v",
  "quiet",
]);
const dll = path.join(build, "bin/Debug/net10.0/OrdinalModelExporter.dll"),
  compiledSha256 = sha(await Bun.file(dll).bytes());
for (const [key, asset] of Object.entries(selected)) {
  const sidecar = path.posix.join(
      path.posix.dirname(asset.model),
      "joint-bindings.json",
    ),
    model = path.join(out, asset.model);
  await run([
    dll,
    path.dirname(path.join(input, asset.model)),
    model,
    path.join(out, sidecar),
  ]);
  const bindings = await Bun.file(path.join(out, sidecar)).json();
  const modelBytes = await Bun.file(model).bytes(),
    modelView = new DataView(
      modelBytes.buffer,
      modelBytes.byteOffset,
      modelBytes.byteLength,
    ),
    gltf = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        modelBytes.subarray(20, 20 + modelView.getUint32(12, true)),
      ),
    );
  const rawRig = await Bun.file(
    path.join(input, path.posix.dirname(asset.model), "model.skl"),
  ).bytes();
  validateOrdinalModelLayout({
    bindings,
    gltf,
    ...readOriginalRigOrdinalSource(rawRig),
  });
  if (
    bindings.modelSha256 !== sha(await Bun.file(model).bytes()) ||
    bindings.rigSha256 !==
      sha(
        await Bun.file(
          path.join(input, path.posix.dirname(asset.model), "model.skl"),
        ).bytes(),
      ) ||
    bindings.meshSha256 !==
      sha(
        await Bun.file(
          path.join(input, path.posix.dirname(asset.model), "model.skn"),
        ).bytes(),
      ) ||
    bindings.geometryHelpers.assemblySha256 !==
      referenceHashes["LeagueToolkit.IO.Extensions.dll"]
  )
    throw Error("Ordinal model source/helper lineage differs");
  asset.rigJointBindings = sidecar;
  asset.rigJointBindingKind = "original-rig-ordinal-model-bindings";
  console.log(
    JSON.stringify({
      actor: key,
      model: asset.model,
      originalJoints: bindings.joints.length,
      palette: bindings.palette.length,
      status: "ordinal-preserved",
    }),
  );
}
for (const [file, digest] of Object.entries(sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`Ordinal exporter source changed: ${file}`);
for (const [file, digest] of Object.entries(referenceHashes))
  if (sha(await Bun.file(path.join(references, file)).bytes()) !== digest)
    throw Error("Approved geometry/material reference changed");
if (sha(await Bun.file(manifestFile).bytes()) !== sha(manifestBytes))
  throw Error("Original actor manifest changed");
const files = [];
for (const file of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  const bytes = await Bun.file(path.join(out, file)).bytes();
  files.push({
    path: file.replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: sha(bytes),
  });
}
const manifest = {
  ...original,
  derivedFrom: {
    kind: "immutable-original-actor-package",
    manifestSha256: sha(manifestBytes),
    sourceFiles: inputs,
  },
  toolchain: {
    ...original.toolchain,
    ordinalModelExporter: {
      sources,
      referenceHashes,
      assemblySha256: compiledSha256,
    },
  },
  champions: Object.fromEntries(
    Object.entries(selected).filter(([, asset]) => asset.role === "champion"),
  ),
  worldAssets: Object.fromEntries(
    Object.entries(selected).filter(([, asset]) => asset.role === "world"),
  ),
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
  spectatorAdmission: false,
};
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    output: out,
    prepared: Object.keys(selected).length,
    originalJointOrdinalsPreserved: true,
    spectatorAdmission: false,
  }),
);

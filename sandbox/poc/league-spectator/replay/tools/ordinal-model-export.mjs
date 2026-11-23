import path from "node:path";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-layout.mjs";

export async function createOrdinalModelExporter({
  sourceCache,
  work,
  dotnet,
}) {
  const sources = {},
    references = path.join(sourceCache, "exporter-build/bin/Debug/net10.0"),
    referenceHashes = {},
    build = path.join(work, "ordinal-model-export-build");
  for (const file of [
    "ordinal-model-export.mjs",
    "ordinal-model/Program.cs",
    "ordinal-model/OrdinalModelExporter.csproj",
    "ordinal-model-layout.mjs",
  ])
    sources[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
  for (const file of new Bun.Glob("*.dll").scanSync({
    cwd: references,
    onlyFiles: true,
  }))
    referenceHashes[file] = sha(
      await Bun.file(path.join(references, file)).bytes(),
    );
  await mkdir(build);
  for (const file of ["Program.cs", "OrdinalModelExporter.csproj"])
    await Bun.write(
      path.join(build, file),
      await Bun.file(new URL(`ordinal-model/${file}`, import.meta.url)).bytes(),
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
        `Ordinal model generation failed(${code}): ${stdout}\n${stderr}`,
      );
    return stdout;
  }
  const sdkVersion = (await run(["--version"])).trim();
  if (sdkVersion !== "10.0.303")
    throw Error("Pinned ordinal model SDK10.0.303 required");
  await run([
    "build",
    path.join(build, "OrdinalModelExporter.csproj"),
    `-p:ExporterDirectory=${references}`,
    "--ignore-failed-sources",
    "-v",
    "quiet",
  ]);
  const dll = path.join(build, "bin/Debug/net10.0/OrdinalModelExporter.dll"),
    assemblySha256 = sha(await Bun.file(dll).bytes());
  let counter = 0;
  async function unchanged() {
    for (const [file, digest] of Object.entries(sources))
      if (
        sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest
      )
        throw Error(`Ordinal model source changed: ${file}`);
    for (const [file, digest] of Object.entries(referenceHashes))
      if (sha(await Bun.file(path.join(references, file)).bytes()) !== digest)
        throw Error("Pinned model reference assembly changed");
  }
  return {
    toolchain: { sdkVersion, sources, referenceHashes, assemblySha256 },
    async exportModel(folder) {
      folder = path.resolve(folder);
      const stage = path.join(work, `ordinal-model-${counter++}`);
      await mkdir(stage);
      const model = path.join(stage, "model.glb"),
        sidecar = path.join(stage, "joint-bindings.json");
      await run([dll, folder, model, sidecar]);
      const modelBytes = await Bun.file(model).bytes(),
        bindingBytes = await Bun.file(sidecar).bytes(),
        bindings = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bindingBytes),
        ),
        rig = await Bun.file(path.join(folder, "model.skl")).bytes(),
        mesh = await Bun.file(path.join(folder, "model.skn")).bytes(),
        view = new DataView(
          modelBytes.buffer,
          modelBytes.byteOffset,
          modelBytes.byteLength,
        ),
        gltf = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            modelBytes.subarray(20, 20 + view.getUint32(12, true)),
          ),
        );
      if (
        bindings.modelSha256 !== sha(modelBytes) ||
        bindings.rigSha256 !== sha(rig) ||
        bindings.meshSha256 !== sha(mesh) ||
        bindings.geometryHelpers.assemblySha256 !==
          referenceHashes["LeagueToolkit.IO.Extensions.dll"]
      )
        throw Error("Original ordinal model source authority differs");
      validateOrdinalModelLayout({
        bindings,
        gltf,
        ...readOriginalRigOrdinalSource(rig),
      });
      await unchanged();
      return { modelBytes, bindingBytes };
    },
    verify: unchanged,
  };
}

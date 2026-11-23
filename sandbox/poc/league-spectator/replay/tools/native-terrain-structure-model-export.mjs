import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-layout.mjs";

const bytes = (path) => Bun.file(path).bytes();
const json = (data) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
const blob = (file, data) => ({ file, bytes: data.length, sha256: sha(data) });
const field = (node, name) => node?.fields?.[mapBinHash(name)];
const value = (node, name) => field(node, name)?.value;
const write = (path, data) => writeFile(path, data, { flag: "wx" });

export async function exportNativeTerrainStructureModels({
  archive,
  character,
  destination,
  exporter,
  wad,
  skinIds = [0, 3],
  skins = skinIds.map((skinId) => ({ character, skinId })),
  requireHiddenRanges = true,
}) {
  const tools = resolve(exporter);
  const assemblies = Object.fromEntries(
    await Promise.all(
      [...new Bun.Glob("*.dll").scanSync({ cwd: tools, onlyFiles: true })]
        .sort()
        .map(async (file) => [file, sha(await bytes(join(tools, file)))]),
    ),
  );
  const runtime = join(tools, "OrdinalModelExporter.runtimeconfig.json");
  const runtimeSha256 = sha(await bytes(runtime));
  await mkdir(destination);
  await mkdir(join(destination, "work"));
  async function tool(file, ...args) {
    if (!assemblies[file]) throw Error(`Missing local model exporter ${file}`);
    const child = Bun.spawn(
      [
        "dotnet",
        "exec",
        "--runtimeconfig",
        runtime,
        join(tools, file),
        ...args,
      ],
      {
        cwd: destination,
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const [status, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw Error(`${file} failed status ${status}: ${stderr}`);
  }

  async function readReference(reference) {
    if (reference?.type === "String") return wad(reference.value);
    if (reference?.type === "WadChunkLink")
      return wad.byHash(BigInt(reference.value));
    throw Error("Expected authored Map11 skin resource reference");
  }

  const assets = {};
  for (const { character, skinId } of skins) {
    const assetId = `${character.toLowerCase()}-${skinId}`;
    const skinPath = `data/characters/${character.toLowerCase()}/skins/skin${skinId}.bin`;
    const folder = join(destination, "work", assetId);
    await mkdir(folder);
    await mkdir(join(destination, assetId));
    const bin = await wad(skinPath);
    const rootPath = `Characters/${character}/Skins/Skin${skinId}`;
    const roots = readExactMapBin(bin).objects.filter(
      ({ pathHash }) => pathHash === mapBinHash(rootPath),
    );
    const mesh = field(roots[0], "skinMeshProperties");
    if (
      roots.length !== 1 ||
      roots[0].classHash !== mapBinHash("SkinCharacterDataProperties") ||
      !mesh
    )
      throw Error("Missing exact authored structure skin root");
    const inputs = { skin: { archive, ...blob(skinPath, bin) } };
    for (const [key, file] of [
      ["simpleSkin", "model.skn"],
      ["skeleton", "model.skl"],
    ]) {
      const reference = field(mesh, key);
      const data = await readReference(reference);
      inputs[key] = {
        archive,
        reference,
        ...blob(`work/${assetId}/${file}`, data),
      };
      await write(join(folder, file), data);
    }
    const rangesFile = join(folder, "ranges.json");
    await tool(
      "Exporter.dll",
      "skin-info",
      join(folder, "model.skn"),
      rangesFile,
    );
    const ranges = json(await bytes(rangesFile));
    if (
      !Array.isArray(ranges) ||
      !ranges.length ||
      new Set(ranges.map((name) => name.toLowerCase())).size !== ranges.length
    )
      throw Error("Expected unique authored structure draw ranges");
    const hideList = value(mesh, "initialSubmeshToHide");
    if (
      typeof hideList !== "string" &&
      (requireHiddenRanges || hideList !== undefined)
    )
      throw Error("Missing authored opening submesh policy");
    const hidden = new Set((hideList ?? "").toLowerCase().split(/\s+/));
    const hiddenRanges = ranges.filter((name) =>
      hidden.has(name.toLowerCase()),
    );
    const skinScale = value(mesh, "skinScale") ?? null;
    if (skinScale !== null && (!Number.isFinite(skinScale) || skinScale <= 0))
      throw Error("Invalid authored structure scale");
    const textureJobs = {};
    const textureBindings = {};
    const textures = new Map();
    const overrides = field(mesh, "materialOverride")?.elements ?? [];
    for (const name of ranges) {
      const selected = overrides.filter(
        (entry) =>
          value(entry, "submesh")?.toLowerCase() === name.toLowerCase(),
      );
      if (
        selected.length > 1 ||
        field(selected[0], "Material") ||
        field(mesh, "Material")
      )
        throw Error("Unresolved or ambiguous authored structure material");
      const reference = field(selected[0], "texture") ?? field(mesh, "texture");
      const key = JSON.stringify(reference);
      if (!textures.has(key)) {
        const file = `texture-${textures.size}`;
        const input = join(folder, file + ".texture");
        const data = await readReference(reference);
        await write(input, data);
        textureJobs[input] = join(folder, file + ".png");
        textures.set(key, {
          reference,
          archive,
          ...blob(`work/${assetId}/${file}.texture`, data),
          png: file + ".png",
        });
      }
      textureBindings[name] = textures.get(key).png;
    }
    const jobsFile = join(folder, "texture-jobs.json");
    await write(jobsFile, JSON.stringify(textureJobs));
    await tool("Exporter.dll", "textures", jobsFile);
    await write(
      join(folder, "texture-bindings.json"),
      JSON.stringify(textureBindings),
    );
    const modelFile = join(destination, assetId, "model.glb");
    const bindingsFile = join(destination, assetId, "joint-bindings.json");
    await tool("OrdinalModelExporter.dll", folder, modelFile, bindingsFile);
    const modelBytes = await bytes(modelFile);
    const model = blob(`${assetId}/model.glb`, modelBytes);
    const jointBytes = await bytes(bindingsFile);
    const joints = json(jointBytes);
    if (
      joints.modelSha256 !== model.sha256 ||
      joints.meshSha256 !== inputs.simpleSkin.sha256 ||
      joints.rigSha256 !== inputs.skeleton.sha256 ||
      joints.geometryHelpers.assemblySha256 !==
        assemblies["LeagueToolkit.IO.Extensions.dll"]
    )
      throw Error("Structure GLB export source identity mismatch");
    const pngs = new Map(
      await Promise.all(
        [...textures.values()].map(async ({ png }) => [
          png,
          sha(await bytes(join(folder, png))),
        ]),
      ),
    );
    const view = new DataView(
      modelBytes.buffer,
      modelBytes.byteOffset,
      modelBytes.byteLength,
    );
    const jsonEnd = 20 + view.getUint32(12, true);
    if (
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== modelBytes.length ||
      view.getUint32(16, true) !== 0x4e4f534a ||
      view.getUint32(jsonEnd + 4, true) !== 0x004e4942 ||
      jsonEnd + 8 + view.getUint32(jsonEnd, true) !== modelBytes.length
    )
      throw Error("Invalid exported structure GLB container");
    const gltf = json(modelBytes.subarray(20, jsonEnd));
    validateOrdinalModelLayout({
      bindings: joints,
      gltf,
      ...readOriginalRigOrdinalSource(await bytes(join(folder, "model.skl"))),
    });
    const primitives = gltf.meshes?.[0]?.primitives;
    if (gltf.meshes?.length !== 1 || primitives?.length !== ranges.length)
      throw Error("Exported structure GLB ranges differ from authored skin");
    const verifiedRanges = ranges.map((name, index) => {
      const material = gltf.materials[primitives[index].material];
      const texture =
        gltf.textures[material?.pbrMetallicRoughness?.baseColorTexture?.index];
      const image = gltf.images[texture?.source];
      const buffer = gltf.bufferViews[image?.bufferView];
      const start = jsonEnd + 8 + (buffer?.byteOffset ?? 0);
      const end = start + buffer?.byteLength;
      const png = textureBindings[name];
      const pngSha256 = pngs.get(png);
      if (
        material?.name !== name ||
        image?.mimeType !== "image/png" ||
        image.uri !== undefined ||
        buffer?.buffer !== 0 ||
        end > modelBytes.length ||
        sha(modelBytes.subarray(start, end)) !== pngSha256
      )
        throw Error(
          `Exported structure GLB material differs from authored range ${name}`,
        );
      return { name, texture: png, pngSha256 };
    });
    assets[assetId] = {
      skinId,
      rootPath,
      skinScale,
      hiddenRanges,
      inputs,
      model,
      jointBindings: blob(`${assetId}/joint-bindings.json`, jointBytes),
      ranges: verifiedRanges,
      textures: [...textures.values()],
    };
  }
  for (const [file, digest] of Object.entries(assemblies))
    if (sha(await bytes(join(tools, file))) !== digest)
      throw Error(`Exporter assembly changed during preparation: ${file}`);
  if (sha(await bytes(runtime)) !== runtimeSha256)
    throw Error("Exporter runtime config changed during preparation");

  return { assets, toolchain: { assemblies, runtimeSha256 } };
}

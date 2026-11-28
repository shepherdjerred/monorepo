// Exact replay-selected opening meshes and authored base-color textures.
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-layout.mjs";
import { openLocalWad } from "./wad.mjs";
import {
  archivedChampionBuild,
  championArchiveExecutableHashes,
  currentChampionBuild,
  verifyNativeCatalogOpening,
} from "./research/native-terrain-champion-model-catalog.mjs";

const expectedProtocol = "8bbfcd5af2bc92db";
const masterYiArmorProjection = {
  argument: "--scout-8428-masteryi-9-armor",
  skinSha256:
    "768ffc72175c002fc1cf375fd8a2e3c5a278f12944edd52525d9316c94649a7f",
  meshSha256:
    "3a58c40f9be01bb9de0f9d022a94b35f54eed669ea8100916e526b02b5579b0d",
};
const args = process.argv.slice(2);
const archiveCatalog = args[0] === "--archive-catalog";
const sourcePin = archiveCatalog ? args[3] : null;
const [
  installation,
  manifestArg,
  outArg,
  toolsArg,
  dotnet = "dotnet",
  ...extra
] = archiveCatalog ? [args[1], args[2], ...args.slice(4)] : args;
if (!installation || !manifestArg || !outArg || !toolsArg || extra.length)
  throw Error(
    [
      "Usage: bun prepare-native-terrain-models.mjs <installation> <opening skin manifest> <new .cache directory> <ordinal exporter bin dir> [dotnet]",
      "       bun prepare-native-terrain-models.mjs --archive-catalog <installation> <skin-inputs.json> <skin-inputs SHA-256> <new .cache directory> <ordinal exporter bin dir> [dotnet]",
    ].join("\n"),
  );
const out = resolve(outArg);
const cache = await realpath(".cache");
const parent = await realpath(dirname(out));
const rel = relative(cache, parent);
if (
  rel === ".." ||
  rel.startsWith(".." + sep) ||
  resolve(cache, rel) !== parent
)
  throw Error("Model output must stay in the private .cache directory");
const output = join(parent, relative(dirname(out), out));
const source = resolve(manifestArg);
const tools = resolve(toolsArg);
const dlls = Object.fromEntries(
  await Promise.all(
    [...new Bun.Glob("*.dll").scanSync({ cwd: tools, onlyFiles: true })].map(
      async (file) => [file, sha(await Bun.file(join(tools, file)).bytes())],
    ),
  ),
);
for (const file of [
  "Exporter.dll",
  "OrdinalModelExporter.dll",
  "LeagueToolkit.IO.Extensions.dll",
])
  if (!dlls[file]) throw Error(`Missing local model tool ${file}`);
const runtime = join(tools, "OrdinalModelExporter.runtimeconfig.json");
const runtimeSha256 = sha(await Bun.file(runtime).bytes());
const json = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const manifestBytes = await Bun.file(source).bytes();
const manifest = json(manifestBytes);
const sourceManifestSha256 = sha(manifestBytes);
const digestPattern = /^[a-f0-9]{64}$/;
const inputSkins = archiveCatalog ? manifest.skins : manifest.actors;
const currentArchive =
  archiveCatalog && manifest.build === currentChampionBuild;
const buildScoped = currentArchive && manifest.selectionKind === "archive";
const executableHash = championArchiveExecutableHashes[manifest.build];
if (
  manifest.schema !== 1 ||
  (!currentArchive && manifest.build !== archivedChampionBuild) ||
  manifest.protocol !== expectedProtocol ||
  manifest.installedExeSha256 !== executableHash ||
  !Array.isArray(inputSkins)
)
  throw Error("Exact build skin resource manifest required");
if (archiveCatalog) {
  if (
    !digestPattern.test(sourcePin) ||
    sourceManifestSha256 !== sourcePin ||
    manifest.kind !== "exact-native-terrain-skin-inputs" ||
    !digestPattern.test(manifest.sourceCensusSha256) ||
    !digestPattern.test(manifest.selectionSha256) ||
    inputSkins.length === 0 ||
    new Set(
      inputSkins.map(
        ({ champion, skinId }) => `${champion.toLowerCase()}-${skinId}`,
      ),
    ).size !== inputSkins.length
  )
    throw Error("Pinned canonical archive skin inputs required");
  if (manifest.selectionKind !== undefined && !buildScoped)
    throw Error("Unknown archive skin selection kind");
  if (buildScoped && manifest.nativeOpening !== undefined)
    throw Error("Build-scoped archive skins cannot contain a match opening");
  if (currentArchive && !buildScoped) {
    const { nativeOpening } = manifest;
    verifyNativeCatalogOpening(
      nativeOpening,
      nativeOpening?.rows,
      nativeOpening?.replaySha256,
    );
    const keys = (skins) =>
      [...new Set(skins.map(({ champion, skinId }) => `${champion}-${skinId}`))]
        .sort()
        .join("/");
    if (keys(nativeOpening.rows) !== keys(inputSkins))
      throw Error(
        "Native opening roster differs from archive skin input selection",
      );
  }
} else if (
  !digestPattern.test(manifest.replaySha256) ||
  inputSkins.length !== 10 ||
  new Set(inputSkins.map(({ context }) => context)).size !== 10 ||
  new Set(inputSkins.map(({ footerRow }) => footerRow)).size !== 10
) {
  throw Error("Exact ten-participant opening skin manifest required");
}
// Archive catalog inputs carry the reviewed WAD index for every skin.
if (
  (!archiveCatalog || currentArchive) &&
  sha(
    await Bun.file(join(installation, "Game", "League of Legends.exe")).bytes(),
  ) !== executableHash
)
  throw Error("Installed game executable does not match the reviewed build");
await mkdir(output);
const stage = join(output, "work");
await mkdir(stage);

const field = (node, name) => node?.fields?.[mapBinHash(name)];
const value = (node, name) => field(node, name)?.value;
const elements = (node, name) => field(node, name)?.elements ?? [];
const readReference = (wad, reference) => {
  if (reference?.type === "WadChunkLink")
    return wad.byHash(BigInt(reference.value));
  if (reference?.type === "String") return wad(reference.value);
  throw Error("Unsupported original resource reference");
};
const blob = (file, bytes) => ({
  file,
  bytes: bytes.byteLength,
  sha256: sha(bytes),
});
const sameReference = (left, right) =>
  left?.type === right?.type && left?.value === right?.value;
const wadCache = new Map();
function openWad(archive, archiveIndexSha256) {
  const key = JSON.stringify([archive, archiveIndexSha256]);
  if (!wadCache.has(key))
    wadCache.set(
      key,
      openLocalWad(
        installation,
        archive,
        Bun.zstdDecompressSync,
        archiveIndexSha256,
      ),
    );
  return wadCache.get(key);
}
async function tool(file, ...args) {
  const child = Bun.spawn(
    [dotnet, "exec", "--runtimeconfig", runtime, join(tools, file), ...args],
    {
      cwd: stage,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0)
    throw Error(`${file} failed status ${status}: ${stdout}\n${stderr}`);
}

async function installMaterialDependencies(definitions, root, wad, archive) {
  const pending = [...root.dependencies];
  const seen = new Set([definitions[0].bin.toLowerCase()]);
  while (pending.length) {
    const bin = pending.shift();
    const key = bin.toLowerCase();
    if (seen.has(key) || !wad.has(bin)) continue;
    seen.add(key);
    const tree = readExactMapBin(await wad(bin));
    definitions.push({ tree, bin, archive });
    pending.push(...tree.dependencies);
  }
}

async function describeMaterial(materialRef, definitions, root, wad, archive) {
  if (materialRef.type !== "ObjectLink")
    throw Error("Expected original material object link");
  const pathHash = materialRef.value.toString(16).padStart(8, "0");
  const matchesIn = (sources) =>
    sources.flatMap(({ tree, bin, archive }) =>
      tree.objects
        .filter((node) => node.pathHash === pathHash)
        .map((node) => ({ node, bin, archive, binSha256: tree.sourceSha256 })),
    );
  // The selected skin can author its own object with the same path as a
  // linked shared material. Traverse only on an unresolved local link.
  let matches = matchesIn(definitions.slice(0, 1));
  if (!matches.length) {
    if (definitions.length === 1)
      await installMaterialDependencies(definitions, root, wad, archive);
    matches = matchesIn(definitions.slice(1));
  }
  if (matches.length !== 1)
    throw Error(
      `Expected one linked material ${pathHash}, found ${matches.length}`,
    );
  const { node, ...origin } = matches[0];
  const samplers = elements(node, "samplerValues").map((sampler) => ({
    name: value(sampler, "TextureName"),
    reference: field(sampler, "texturePath"),
  }));
  const shader = field(node, "name");
  return {
    objectHash: pathHash,
    classHash: node.classHash,
    ...origin,
    samplers,
    ...(shader?.type === "Hash64" && shader.value === "3485991204182179237"
      ? { shader }
      : {}),
  };
}

function baseColor(material) {
  const mainTexture = /^Main_?Texture$/i;
  // This shader uses Diffuse_Texture's RGB channels for distortion and
  // Main_Texture for the actor color. Export only the authored color input.
  const patterns = material.shader
    ? [mainTexture]
    : [
        /^(Diffuse_?Texture|Diffuse_Sword_Texture)$/i,
        /^(Diffuse_Color|Diff_Tex)$/i,
        mainTexture,
      ];
  for (const pattern of patterns) {
    const matches = material.samplers.filter(({ name }) => pattern.test(name));
    if (matches.length === 1 && matches[0].reference) return matches[0];
    if (matches.length) break;
  }
  throw Error(
    `No unique authored base-color sampler for ${material.objectHash}`,
  );
}

async function verifySaved(file, receipt, original) {
  if (receipt?.file !== file)
    throw Error(`Unexpected source file path ${file}`);
  const bytes = await Bun.file(join(dirname(source), file)).bytes();
  if (
    bytes.byteLength !== receipt.bytes ||
    sha(bytes) !== receipt.sha256 ||
    sha(original) !== receipt.sha256
  )
    throw Error(`Saved exact resource differs from installation: ${file}`);
  return bytes;
}

const actors = [];
for (const actor of inputSkins) {
  const { champion, context, footerRow, skinId, resources } = actor;
  if (
    !/^[A-Za-z0-9_]+$/.test(champion) ||
    !Number.isSafeInteger(skinId) ||
    skinId < 0 ||
    skinId > 10000 ||
    (!archiveCatalog &&
      (!Number.isSafeInteger(context) ||
        !Number.isSafeInteger(footerRow) ||
        footerRow < 1 ||
        footerRow > 10))
  )
    throw Error("Invalid original opening champion binding");
  const directory = `${champion.toLowerCase()}-${skinId}`;
  const archive = `DATA/FINAL/Champions/${champion}.wad.client`;
  const skinPath = `data/characters/${champion.toLowerCase()}/skins/skin${skinId}.bin`;
  const rootPath = `Characters/${champion}/Skins/Skin${skinId}`;
  if (
    actor.archive !== archive ||
    actor.rootPath !== rootPath ||
    resources.skin.reference !== skinPath
  )
    throw Error(`Original opening skin paths differ for ${champion}`);
  if (archiveCatalog && !digestPattern.test(actor.archiveIndexSha256))
    throw Error(`Pinned WAD archive index required for ${champion}`);
  const wad = await openWad(
    archive,
    archiveCatalog ? actor.archiveIndexSha256 : undefined,
  );
  const bin = await verifySaved(
    `${directory}/skin.bin`,
    resources.skin,
    await wad(skinPath),
  );
  const tree = readExactMapBin(bin);
  const root = tree.objects.find(
    (node) => node.pathHash === mapBinHash(rootPath),
  );
  const mesh = field(root, "skinMeshProperties");
  if (root?.classHash !== mapBinHash("SkinCharacterDataProperties") || !mesh)
    throw Error(`Original skin mesh declaration missing: ${rootPath}`);
  const folder = join(stage, directory);
  await mkdir(folder);
  const inputs = { skin: resources.skin };
  for (const [key, filename] of [
    ["simpleSkin", "model.skn"],
    ["skeleton", "model.skl"],
    ["texture", "default.tex"],
  ]) {
    const receipt = resources[key === "texture" ? "defaultTexture" : key];
    const reference = field(mesh, key);
    if (!reference && key === "texture" && !receipt) continue;
    if (!sameReference(reference, receipt?.reference))
      throw Error(`Original skin resource reference differs: ${key}`);
    const bytes = await verifySaved(
      `${directory}/${filename}`,
      receipt,
      await readReference(wad, reference),
    );
    inputs[key] = receipt;
    if (key !== "texture")
      await writeFile(join(folder, filename), bytes, { flag: "wx" });
  }
  const rangePath = join(folder, "ranges.json");
  await tool("Exporter.dll", "skin-info", join(folder, "model.skn"), rangePath);
  const names = await Bun.file(rangePath).json();
  if (
    !Array.isArray(names) ||
    !names.length ||
    names.some((name) => typeof name !== "string" || !name.length) ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length
  )
    throw Error(`Invalid original material ranges for ${champion}`);
  const skinScale = value(mesh, "skinScale") ?? null;
  const hideList = value(mesh, "initialSubmeshToHide") ?? null;
  if (
    (skinScale !== null && (!Number.isFinite(skinScale) || skinScale <= 0)) ||
    (hideList !== null && typeof hideList !== "string")
  )
    throw Error(`Invalid original opening skin presentation for ${champion}`);
  const hideNames = new Set(
    (hideList ?? "")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean),
  );
  const hiddenRanges = names.filter((name) =>
    hideNames.has(name.toLowerCase()),
  );
  const definitions = [{ tree, bin: skinPath, archive }];
  const overrides = elements(mesh, "materialOverride");
  const jobs = {};
  const bindings = {};
  const textures = new Map();
  const ranges = [];
  for (const [index, name] of names.entries()) {
    const record = { name, index, hidden: hiddenRanges.includes(name) };
    ranges.push(record);
    try {
      const selected = overrides.filter(
        (entry) =>
          value(entry, "submesh")?.toLowerCase() === name.toLowerCase(),
      );
      if (selected.length > 1)
        throw Error("Ambiguous original submesh override");
      const override = selected[0];
      const materialRef =
        field(override, "Material") ?? field(mesh, "Material");
      if (materialRef) record.materialLink = materialRef;
      let reference = field(override, "texture");
      let origin = "submesh-texture";
      if (!reference && materialRef) {
        record.material = await describeMaterial(
          materialRef,
          definitions,
          tree,
          wad,
          archive,
        );
        const sampler = baseColor(record.material);
        reference = sampler.reference;
        record.sampler = sampler.name;
        origin = "linked-material-base-color";
      }
      if (!reference) {
        reference = field(mesh, "texture");
        origin = "skin-texture";
      }
      const key = JSON.stringify(reference);
      if (!textures.has(key)) {
        const bytes = await readReference(wad, reference);
        const filename = `texture-${textures.size}`;
        const raw = join(folder, filename + ".texture");
        await writeFile(raw, bytes, { flag: "wx" });
        jobs[raw] = join(folder, filename + ".png");
        textures.set(key, {
          archive,
          reference,
          bytes: bytes.length,
          sha256: sha(bytes),
          filename: filename + ".png",
        });
      }
      const { filename, ...texture } = textures.get(key);
      bindings[name] = filename;
      record.texture = { ...texture, origin };
    } catch (error) {
      record.unresolved = String(error.message);
    }
  }
  const result = {
    champion,
    ...(archiveCatalog
      ? { archiveIndexSha256: actor.archiveIndexSha256 }
      : { context, footerRow }),
    skinId,
    skinScale,
    hiddenRanges,
    ranges,
    inputs,
  };
  actors.push(result);
  if (ranges.some((record) => record.unresolved)) {
    result.unresolved = ranges
      .filter((record) => record.unresolved)
      .map((record) => `${record.name}: ${record.unresolved}`)
      .join("; ");
    continue;
  }
  const jobPath = join(folder, "texture-jobs.json");
  await writeFile(jobPath, JSON.stringify(jobs), { flag: "wx" });
  await tool("Exporter.dll", "textures", jobPath);
  const pngHashes = new Map(
    await Promise.all(
      Object.values(jobs).map(async (file) => [
        file,
        sha(await Bun.file(file).bytes()),
      ]),
    ),
  );
  await writeFile(
    join(folder, "texture-bindings.json"),
    JSON.stringify(bindings),
    { flag: "wx" },
  );
  const modelPath = `${directory}/model.glb`;
  const bindingsPath = `${directory}/joint-bindings.json`;
  const projectMasterYiArmor =
    currentArchive && champion.toLowerCase() === "masteryi" && skinId === 9;
  if (
    projectMasterYiArmor &&
    (inputs.skin.sha256 !== masterYiArmorProjection.skinSha256 ||
      inputs.simpleSkin.sha256 !== masterYiArmorProjection.meshSha256 ||
      ranges[0]?.name !== "Armor" ||
      ranges[0].materialLink !== undefined ||
      ranges[0].texture.origin !== "skin-texture" ||
      ranges[0].texture.sha256 !== inputs.texture?.sha256)
  )
    throw Error(
      "Scout Master Yi Armor projection requires the reviewed archived skin and default texture",
    );
  await tool(
    "OrdinalModelExporter.dll",
    folder,
    join(output, modelPath),
    join(output, bindingsPath),
    ...(projectMasterYiArmor ? [masterYiArmorProjection.argument] : []),
  );
  const model = await Bun.file(join(output, modelPath)).bytes();
  const joints = await Bun.file(join(output, bindingsPath)).bytes();
  const jointReceipt = json(joints);
  const view = new DataView(model.buffer, model.byteOffset, model.byteLength);
  const jsonEnd = 20 + view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== model.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(jsonEnd + 4, true) !== 0x004e4942 ||
    jsonEnd + 8 + view.getUint32(jsonEnd, true) !== model.length
  )
    throw Error(`Invalid ordinal GLB container for ${champion}`);
  const gltf = json(model.subarray(20, jsonEnd));
  validateOrdinalModelLayout({
    bindings: jointReceipt,
    gltf,
    ...readOriginalRigOrdinalSource(
      await Bun.file(join(folder, "model.skl")).bytes(),
    ),
  });
  if (
    jointReceipt.modelSha256 !== sha(model) ||
    jointReceipt.meshSha256 !== inputs.simpleSkin.sha256 ||
    jointReceipt.rigSha256 !== inputs.skeleton.sha256 ||
    jointReceipt.geometryHelpers.assemblySha256 !==
      dlls["LeagueToolkit.IO.Extensions.dll"]
  )
    throw Error(`Ordinal model input binding differs for ${champion}`);
  const primitives = gltf.meshes?.[0]?.primitives;
  if (gltf.meshes?.length !== 1 || primitives?.length !== ranges.length)
    throw Error(`GLB primitive count differs from SKN for ${champion}`);
  if (projectMasterYiArmor) {
    const { attributes } = primitives[0];
    if (
      Object.hasOwn(attributes, "TANGENT") ||
      ["POSITION", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"].some(
        (name) => !Number.isInteger(attributes[name]),
      ) ||
      !Number.isInteger(primitives[0].indices)
    )
      throw Error(
        "GLB does not contain the reviewed Scout Armor vertex inputs",
      );
    ranges[0].omittedUnusedVertexAttributes = ["TANGENT"];
  }
  for (const [index, range] of ranges.entries()) {
    const materialIndex = primitives[index].material;
    const material = gltf.materials[materialIndex];
    const texture =
      gltf.textures[material?.pbrMetallicRoughness?.baseColorTexture?.index];
    const image = gltf.images[texture?.source];
    const buffer = gltf.bufferViews[image?.bufferView];
    const start = jsonEnd + 8 + (buffer?.byteOffset ?? 0);
    const end = start + buffer?.byteLength;
    const pngSha256 = pngHashes.get(join(folder, bindings[range.name]));
    if (
      material?.name !== range.name ||
      image?.mimeType !== "image/png" ||
      image.uri !== undefined ||
      buffer?.buffer !== 0 ||
      end > model.length ||
      sha(model.subarray(start, end)) !== pngSha256
    )
      throw Error(
        `GLB embedded material order differs for ${champion}/${range.name}`,
      );
    range.materialIndex = materialIndex;
    range.texture.pngSha256 = pngSha256;
  }
  result.model = blob(modelPath, model);
  result.jointBindings = blob(bindingsPath, joints);
}

for (const [file, digest] of Object.entries(dlls))
  if (sha(await Bun.file(join(tools, file)).bytes()) !== digest)
    throw Error(`Model tool changed during preparation: ${file}`);
if (sha(await Bun.file(source).bytes()) !== sourceManifestSha256)
  throw Error("Opening skin manifest changed during preparation");
if (sha(await Bun.file(runtime).bytes()) !== runtimeSha256)
  throw Error("Model tool runtime configuration changed during preparation");
if (archiveCatalog && actors.some((actor) => !actor.model))
  throw Error(
    "Incomplete archive catalog: " +
      actors
        .filter((actor) => !actor.model)
        .map(
          ({ champion, skinId, unresolved }) =>
            `${champion}-${skinId}: ${unresolved}`,
        )
        .join("; "),
  );
const receipt = archiveCatalog
  ? {
      schema: 1,
      kind: "exact-native-terrain-champion-catalog",
      build: manifest.build,
      protocol: manifest.protocol,
      installedExeSha256: executableHash,
      sourceManifestSha256,
      sourceCensusSha256: manifest.sourceCensusSha256,
      selectionSha256: manifest.selectionSha256,
      ...(buildScoped ? { selectionKind: "archive" } : {}),
      ...(currentArchive && !buildScoped
        ? { nativeOpening: manifest.nativeOpening }
        : {}),
      toolchain: { assemblies: dlls, runtimeSha256 },
      scope:
        "Archived SKN, SKL and authored base-color images. Match legality, native shader passes and animation are separate.",
      assets: Object.fromEntries(
        actors.map((asset) => [
          `${asset.champion.toLowerCase()}-${asset.skinId}`,
          asset,
        ]),
      ),
    }
  : {
      schema: 1,
      kind: "exact-native-terrain-models",
      build: manifest.build,
      protocol: manifest.protocol,
      replaySha256: manifest.replaySha256,
      sourceManifestSha256,
      installedExeSha256: executableHash,
      toolchain: { assemblies: dlls, runtimeSha256 },
      scope:
        "Opening SKN geometry, SKL rig, and authored base-color images. Native shader passes, parameter evaluation, variant switching, and animation require separate evidence.",
      actors,
    };
const receiptText = JSON.stringify(receipt, null, 2);
await writeFile(join(output, "manifest.json"), receiptText, { flag: "wx" });
console.log(
  JSON.stringify({
    output,
    ...(archiveCatalog
      ? { manifestSha256: sha(new TextEncoder().encode(receiptText)) }
      : {}),
    models: actors.filter((actor) => actor.model).length,
    unresolved: actors
      .filter((actor) => actor.unresolved)
      .map(({ champion, unresolved }) => ({ champion, unresolved })),
  }),
);

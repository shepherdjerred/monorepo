import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { actorObjectHash } from "./archived-actor-bin.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { identifyArchivedFxFormat } from "./archived-fx-formats.mjs";

const [sceneArg, effectsArg] = process.argv.slice(2);
if (!effectsArg)
  throw Error(
    "Usage: bun verify-archived-scene-effects.mjs <closed-common-scene> <closed-effects-package>",
  );
const root = path.resolve(effectsArg),
  sceneRoot = path.resolve(sceneArg),
  sceneBytes = await Bun.file(path.join(sceneRoot, "manifest.json")).bytes(),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  manifestBytes = await Bun.file(path.join(root, "manifest.json")).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
if (
  manifest.kind !== "archived-map11-partial-effects" ||
  manifest.schema !== 1 ||
  manifest.build !== scene.build ||
  manifest.protocol !== scene.protocol ||
  manifest.sceneManifestSha256 !== sha(sceneBytes) ||
  manifest.nativeSpectatorAdmitted !== false ||
  scene.map.id !== 11
)
  throw Error("Matching partial archived scene/effects authority required");
const selected = new Map();
for (const entry of manifest.files) {
  sceneAnimationFilePath(entry.path);
  if (selected.has(entry.path)) throw Error("Duplicate archived FX output");
  selected.set(entry.path, entry);
}
async function read(file) {
  sceneAnimationFilePath(file);
  const entry = selected.get(file);
  if (!entry) throw Error(`Unselected archived FX file: ${file}`);
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`Archived FX file differs: ${file}`);
  return bytes;
}
for (const file of selected.keys()) await read(file);
let textures = 0,
  staticMeshes = 0,
  unsupported = 0,
  definitions = 0,
  bindings = 0;
for (const [key, asset] of Object.entries(manifest.assets)) {
  if (!asset.rawFile) {
    if (asset.status !== "unprepared" || !asset.reason)
      throw Error(
        `Unresolved FX dependency omitted explicit capability: ${key}`,
      );
    unsupported++;
    continue;
  }
  const raw = await read(asset.rawFile),
    format = identifyArchivedFxFormat(raw);
  if (
    sha(raw) !== asset.sourceSha256 ||
    format.format !== asset.format.format ||
    format.translation !== asset.format.translation
  )
    throw Error(`Original FX resource differs: ${key}`);
  if (asset.status === "unprepared") {
    if (!asset.reason || asset.file)
      throw Error("Untranslated FX resource became renderable");
    unsupported++;
    continue;
  }
  if (asset.status !== "prepared" || !asset.file)
    throw Error("Unknown archived FX translation state");
  const bytes = await read(asset.file);
  if (asset.bytes !== bytes.length || asset.sha256 !== sha(bytes))
    throw Error("Converted FX identity differs");
  if (asset.kind === "texture") {
    if (format.translation !== "pinned-texture-mip0" || bytes.length < 24)
      throw Error("Unadmitted FX texture translation");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0) !== 0x89504e47 ||
      view.getUint32(12) !== 0x49484452 ||
      view.getUint32(16) !== format.width ||
      view.getUint32(20) !== format.height
    )
      throw Error("Original FX texture dimensions differ");
    textures++;
  } else if (asset.kind === "static-mesh") {
    const mesh = JSON.parse(new TextDecoder().decode(bytes));
    if (
      format.translation !== "pinned-static-mesh" ||
      !mesh.positions?.length ||
      mesh.positions.length % 9 ||
      mesh.uv.length * 3 !== mesh.positions.length * 2 ||
      ![...mesh.positions, ...mesh.uv].every(Number.isFinite)
    )
      throw Error("Unadmitted FX static mesh translation");
    staticMeshes++;
  } else throw Error("Prepared unsupported FX kind");
}
for (const [id, index] of Object.entries(manifest.definitions)) {
  const bytes = await read(index.file),
    definition = JSON.parse(new TextDecoder().decode(bytes));
  if (
    sha(bytes) !== index.sha256 ||
    definition.actor !== index.actor ||
    definition.definition.__type !== index.class ||
    !manifest.actors[index.actor]
  )
    throw Error(`FX definition index differs: ${id}`);
  for (const dependency of definition.dependencies)
    if (!manifest.assets[dependency.path])
      throw Error(`FX definition lost a dependency: ${dependency.path}`);
  for (const reference of definition.references)
    if (!manifest.definitions[reference.effectId])
      throw Error(
        `FX definition lost an original object reference: ${reference.effectId}`,
      );
  definitions++;
}
const sceneWorld = await Bun.file(path.join(sceneRoot, scene.world)).json(),
  appearances = new Map([
    ...Object.entries(scene.champions).map(([key, value]) => [
      `champions/${key}`,
      value,
    ]),
    ...Object.entries(sceneWorld.assets).map(([key, value]) => [
      `world/${key}`,
      value,
    ]),
  ]);
if (appearances.size !== Object.keys(manifest.actors).length)
  throw Error("FX package omitted selected appearances");
for (const [key, actor] of Object.entries(manifest.actors)) {
  const appearance = appearances.get(key);
  if (
    !appearance ||
    appearance.character !== actor.character ||
    appearance.skinId !== actor.skinId
  )
    throw Error("FX package changed an appearance");
  for (const collection of [actor.resources, actor.missiles])
    for (const binding of Object.values(collection))
      if (binding.status === "prepared-definition") {
        const definition = manifest.definitions[binding.effectId];
        if (
          !definition ||
          definition.actor !== key ||
          actorObjectHash(definition.class) !==
            actorObjectHash("VfxSystemDefinitionData")
        )
          throw Error(
            "FX binding changed its appearance or native definition class",
          );
        bindings++;
      }
}
console.log(
  JSON.stringify({
    manifestSha256: sha(manifestBytes),
    filesVerified: selected.size,
    appearances: appearances.size,
    definitions,
    preparedSourceBindings: bindings,
    textureReferences: textures,
    staticMeshReferences: staticMeshes,
    unsupportedAssetReferences: unsupported,
    nativeSpectatorAdmitted: false,
  }),
);

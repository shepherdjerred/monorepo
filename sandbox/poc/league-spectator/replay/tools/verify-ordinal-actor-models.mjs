import path from "node:path";
import { createHash } from "node:crypto";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "./ordinal-model-layout.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
const [manifestArg] = process.argv.slice(2);
if (!manifestArg)
  throw Error(
    "Usage: bun verify-ordinal-actor-models.mjs <ordinal-actor-manifest.json>",
  );
const root = path.dirname(path.resolve(manifestArg)),
  manifest = await Bun.file(manifestArg).json(),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  inventory = new Map(manifest.files.map((file) => [file.path, file]));
async function read(file) {
  sceneAnimationFilePath(file);
  const expected = inventory.get(file);
  if (!expected) throw Error("Uninventoried model source");
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error("Ordinal model source digest differs");
  return bytes;
}
let models = 0,
  totalJoints = 0,
  totalPalette = 0;
const duplicates = [];
for (const [key, asset] of Object.entries({
  ...manifest.champions,
  ...manifest.worldAssets,
})) {
  const model = await read(asset.model),
    bindings = JSON.parse(
      new TextDecoder().decode(await read(asset.rigJointBindings)),
    ),
    folder = path.posix.dirname(asset.model),
    rig = await read(`${folder}/model.skl`),
    mesh = await read(`${folder}/model.skn`),
    view = new DataView(model.buffer, model.byteOffset, model.byteLength),
    jsonLength = view.getUint32(12, true),
    gltf = JSON.parse(
      new TextDecoder().decode(model.subarray(20, 20 + jsonLength)),
    );
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    bindings.modelSha256 !== sha(model) ||
    bindings.rigSha256 !== sha(rig) ||
    bindings.meshSha256 !== sha(mesh)
  )
    throw Error("Original ordinal model source identities differ");
  const source = readOriginalRigOrdinalSource(rig),
    layout = validateOrdinalModelLayout({ bindings, gltf, ...source });
  const binHeader = 20 + jsonLength,
    binLength = view.getUint32(binHeader, true),
    binStart = binHeader + 8;
  if (
    view.getUint32(binHeader + 4, true) !== 0x004e4942 ||
    binStart + binLength > model.length
  )
    throw Error("Ordinal GLB binary bounds differ");
  function accessor(id) {
    const a = gltf.accessors[id],
      b = gltf.bufferViews[a.bufferView],
      width = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    if (a.type !== "VEC4" || a.sparse || !width || b.buffer !== 0)
      throw Error("Unadmitted vertex skin accessor");
    const start = binStart + (b.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = b.byteStride ?? width * 4;
    if (
      stride < width * 4 ||
      start < binStart ||
      start + (a.count - 1) * stride + width * 4 > binStart + binLength
    )
      throw Error("Vertex skin accessor bounds differ");
    return {
      count: a.count,
      get: (index, lane) => {
        const at = start + index * stride + lane * width;
        return a.componentType === 5121
          ? view.getUint8(at)
          : a.componentType === 5123
            ? view.getUint16(at, true)
            : a.componentType === 5125
              ? view.getUint32(at, true)
              : view.getFloat32(at, true);
      },
    };
  }
  const digest = createHash("sha256");
  let vertices = 0,
    weighted = 0;
  for (const primitive of gltf.meshes[0].primitives) {
    const ids = accessor(primitive.attributes.JOINTS_0),
      weights = accessor(primitive.attributes.WEIGHTS_0);
    if (ids.count !== weights.count)
      throw Error("Vertex index/weight coverage differs");
    for (let vertex = 0; vertex < ids.count; vertex++)
      for (let lane = 0; lane < 4; lane++) {
        const id = ids.get(vertex, lane),
          weight = weights.get(vertex, lane);
        if (
          !Number.isSafeInteger(id) ||
          id < 0 ||
          id >= source.sourcePalette.length ||
          !Number.isFinite(weight) ||
          weight < 0
        )
          throw Error("Serialized skin slot/weight out of bounds");
        if (weight > 0) {
          const row = new Uint8Array(10),
            data = new DataView(row.buffer);
          data.setInt32(0, vertices + vertex, true);
          data.setInt32(4, lane, true);
          data.setInt16(8, source.sourcePalette[id], true);
          digest.update(row);
          weighted++;
        }
      }
    vertices += ids.count;
  }
  if (
    vertices !== bindings.vertexSkinning.sourceVertices ||
    weighted !== bindings.vertexSkinning.weightedLanes ||
    digest.digest("hex") !==
      bindings.vertexSkinning.sourceWeightedJointIdsSha256
  )
    throw Error("Serialized GLB lost original SKN weighted joint identity");
  const names = new Map();
  for (let ordinal = 0; ordinal < source.sourceJoints.length; ordinal++) {
    const name = source.sourceJoints[ordinal].name;
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(ordinal);
  }
  for (const [name, ordinals] of names)
    if (ordinals.length > 1)
      duplicates.push({
        actor: key,
        name,
        ordinals,
        nodes: ordinals.map((index) => layout.jointNodeIndices[index]),
        parents: ordinals.map((index) => source.sourceJoints[index].parentId),
        paletteSlots: ordinals.map((index) =>
          bindings.palette
            .filter((entry) => entry.poseJointIndex === index)
            .map((entry) => entry.paletteIndex),
        ),
      });
  totalJoints += source.sourceJoints.length;
  totalPalette += source.sourcePalette.length;
  models++;
}
console.log(
  JSON.stringify({
    models,
    originalJointOrdinals: totalJoints,
    sourcePaletteEntries: totalPalette,
    duplicates,
    sourceWeightedSkinMappingVerified: true,
    nativeSpectatorAdmitted: false,
  }),
);

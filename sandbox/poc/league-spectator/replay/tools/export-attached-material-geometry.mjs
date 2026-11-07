// Real GLB vertex streams and a declared preview pose for an offscreen shader
// diagnostic. This does not recover the client's mesh/pose binding controller.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAnimationPoses } from "./load-animation-poses.mjs";
import { sampleAnimationFrame } from "../latest-animation.mjs";
import { sampleLatestDeathPosePreview } from "../latest-lifecycle.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: export-attached-material-geometry.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  proof = await json(`${cache}/research/attached-mesh-comparison.json`),
  c = proof.example,
  scene = await json(`${assets}/latest-scene/manifest.json`),
  asset = scene.champions[c.asset],
  model = await raw(`${assets}/latest-scene/${asset.model}`),
  view = new DataView(model.buffer),
  chunks = new Map();
if (
  view.getUint32(0, true) !== 0x46546c67 ||
  view.getUint32(4, true) !== 2 ||
  view.getUint32(8, true) !== model.length
)
  throw Error("Invalid diagnostic GLB");
for (let at = 12; at < model.length;) {
  const n = view.getUint32(at, true),
    kind = view.getUint32(at + 4, true);
  if (at + 8 + n > model.length || chunks.has(kind))
    throw Error("Invalid GLB chunk");
  chunks.set(kind, model.subarray(at + 8, at + 8 + n));
  at += 8 + n;
}
const gltf = JSON.parse(new TextDecoder().decode(chunks.get(0x4e4f534a))),
  bin = chunks.get(0x004e4942),
  data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
  widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
  types = {
    5121: [1, "getUint8", 255],
    5123: [2, "getUint16", 65535],
    5125: [4, "getUint32", 0xffffffff],
    5126: [4, "getFloat32", null],
  },
  memo = new Map();
function accessor(id) {
  if (memo.has(id)) return memo.get(id);
  const a = gltf.accessors[id],
    v = gltf.bufferViews[a.bufferView],
    [size, getter, max] = types[a.componentType] ?? [],
    width = widths[a.type];
  if (a.sparse || !v || v.buffer !== 0 || !size || !width)
    throw Error("Unsupported diagnostic accessor");
  const rows = Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: width }, (_, j) => {
      let x = data[getter](
        (v.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (v.byteStride ?? size * width) +
          j * size,
        true,
      );
      return a.normalized ? x / max : x;
    }),
  );
  memo.set(id, rows);
  return rows;
}
const THREE = await import(
    pathToFileURL(`${assets}/vendor/three.module.js`).href
  ),
  nodes = gltf.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name ?? "";
    if (n.matrix)
      new THREE.Matrix4()
        .fromArray(n.matrix)
        .decompose(o.position, o.quaternion, o.scale);
    else {
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    return o;
  }),
  root = new THREE.Group();
for (const [i, n] of gltf.nodes.entries())
  for (const child of n.children ?? []) nodes[i].add(nodes[child]);
for (const id of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[id]);
root.scale.set(asset.scale, asset.scale, -asset.scale);
const factory = await loadAnimationPoses(`${assets}/latest-scene`),
  binding = await factory.bind(asset),
  pose = sampleLatestDeathPosePreview(
    binding.graph,
    {
      dead: true,
      interval: { death: { time: c.deathTime }, postDeathActions: [] },
    },
    c.time,
  );
for (const layer of pose.leaves) {
  await raw(
    `${assets}/latest-animation-poses/${binding.directory}/${layer.file}`,
  );
  const clip = await binding.read(layer.file);
  for (const track of clip.tracks) {
    const weight =
      (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
    if (!weight) continue;
    const targets = nodes.filter(
      (n) => n.name === THREE.PropertyBinding.sanitizeNodeName(track.bone),
    );
    if (targets.length !== 1) throw Error("Ambiguous pose bone");
    const n = targets[0],
      sample = sampleAnimationFrame(
        track,
        layer.sourceFrame ?? layer.phase * clip.fps,
      );
    if (track.channel === "quaternion")
      n.quaternion.slerp(
        new THREE.Quaternion()
          .fromArray(sample.a)
          .slerp(new THREE.Quaternion().fromArray(sample.b), sample.fraction),
        weight,
      );
    else
      n[track.channel].lerp(
        new THREE.Vector3()
          .fromArray(sample.a)
          .lerp(new THREE.Vector3().fromArray(sample.b), sample.fraction),
        weight,
      );
  }
}
root.updateMatrixWorld(true);
const submesh = await json(`${assets}/latest-submesh-visibility/package.json`),
  ranges = Object.values(submesh.assets).find(
    (a) => a.model === asset.model,
  ).ranges,
  rangeMasks = new Map(ranges.map((r) => [r.name.toLowerCase(), r.mask])),
  parts = [],
  points = [];
for (const n of gltf.nodes) {
  if (n.mesh === undefined) continue;
  const skin = gltf.skins[n.skin];
  if (!skin || skin.joints.length > 256)
    throw Error("Unsupported diagnostic skin");
  const inverse = accessor(skin.inverseBindMatrices),
    matrices = skin.joints.map((id, i) =>
      new THREE.Matrix4().multiplyMatrices(
        nodes[id].matrixWorld,
        new THREE.Matrix4().fromArray(inverse[i]),
      ),
    ),
    palette = Array(256 * 12).fill(0);
  matrices.forEach((m, i) => {
    for (let r = 0; r < 3; r++)
      for (let col = 0; col < 4; col++)
        palette[i * 12 + r * 4 + col] = m.elements[col * 4 + r];
  });
  for (const p of gltf.meshes[n.mesh].primitives) {
    const name = gltf.materials[p.material].name,
      mask = rangeMasks.get(name.toLowerCase());
    if (mask === undefined) throw Error("Unbound diagnostic range");
    const positions = accessor(p.attributes.POSITION),
      normals = accessor(p.attributes.NORMAL),
      weights = accessor(p.attributes.WEIGHTS_0),
      joints = accessor(p.attributes.JOINTS_0),
      uvs = accessor(p.attributes.TEXCOORD_0),
      indices = accessor(p.indices).flat();
    if (p.mode !== undefined && p.mode !== 4)
      throw Error("Diagnostic requires triangles");
    const vertices = Buffer.alloc(positions.length * 64);
    positions.forEach((position, i) => {
      if (
        joints[i].some(
          (j) => !Number.isInteger(j) || j < 0 || j >= skin.joints.length,
        )
      )
        throw Error("Out of range diagnostic joint");
      const base = i * 64;
      [...position, ...weights[i], ...normals[i]].forEach((v, k) =>
        vertices.writeFloatLE(v, base + k * 4),
      );
      joints[i].forEach((v, k) => vertices.writeUInt32LE(v, base + 40 + k * 4));
      uvs[i].forEach((v, k) => vertices.writeFloatLE(v, base + 56 + k * 4));
      const world = new THREE.Vector3();
      for (let k = 0; k < 4; k++)
        if (weights[i][k])
          world.addScaledVector(
            new THREE.Vector3()
              .fromArray(position)
              .applyMatrix4(matrices[joints[i][k]]),
            weights[i][k],
          );
      if (
        mask &
        c.layers
          .filter((l) => l.emitterIndex === 15 || l.emitterIndex === 16)
          .reduce((m, l) => m | l.mask, 0)
      )
        points.push(world);
    });
    const indexBytes = Buffer.alloc(indices.length * 4);
    indices.forEach((id, i) => {
      if (id >= positions.length)
        throw Error("Out of range diagnostic triangle");
      indexBytes.writeUInt32LE(id, i * 4);
    });
    parts.push({
      name,
      mask,
      verticesHex: vertices.toString("hex"),
      indicesHex: indexBytes.toString("hex"),
      vertexCount: positions.length,
      triangleCount: indices.length / 3,
      palette,
    });
  }
}
const bounds = new THREE.Box3().setFromPoints(points),
  center = bounds.getCenter(new THREE.Vector3()),
  radius = bounds.getSize(new THREE.Vector3()).length(),
  camera = new THREE.OrthographicCamera(
    -radius * 0.37,
    radius * 0.37,
    radius * 0.37,
    -radius * 0.37,
    0.1,
    radius * 20,
  );
camera.position
  .copy(center)
  .add(new THREE.Vector3(1.3, 1.2, 1.7).multiplyScalar(radius));
camera.lookAt(center);
camera.updateMatrixWorld();
const projection = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  ),
  d3d = new THREE.Matrix4().set(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    0.5,
    0.5,
    0,
    0,
    0,
    1,
  );
projection.premultiply(d3d);
const projectionRows = [];
for (let r = 0; r < 4; r++)
  for (let col = 0; col < 4; col++)
    projectionRows.push(projection.elements[col * 4 + r]);
const output = {
  schema: 1,
  kind: "attached-mesh-supplied-pose-streams",
  asset: c.asset,
  modelSha256: sha(model),
  example: c,
  parts,
  projectionRows,
  cameraPosition: camera.position.toArray(),
  cameraForward: camera.getWorldDirection(new THREE.Vector3()).toArray(),
  cameraUp: camera.up.toArray(),
  inputs,
  exporterSha256: sha(await raw(import.meta.path)),
  scope: {
    installedGeometry: true,
    suppliedPreparedDeathPose: true,
    nativeMeshPoseBindingExecuted: false,
    originalGpuPaletteBindingVerified: false,
    browserRun: false,
    referencePixelsCompared: false,
  },
};
await Bun.write(
  `${cache}/research/attached-material-geometry.json`,
  JSON.stringify(output),
);
console.log(
  JSON.stringify({
    parts: parts.length,
    vertices: parts.reduce((s, p) => s + p.vertexCount, 0),
    triangles: parts.reduce((s, p) => s + p.triangleCount, 0),
  }),
);

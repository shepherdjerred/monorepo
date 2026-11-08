// Diagnostic CPU projection of installed GLB geometry and prepared pose layers.
// Texture colors are sampled per triangle; this is not the game shader pipeline.
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { sampleAnimationFrame } from "../latest-animation.mjs";
export async function loadSoftwareAvatar(
  THREE,
  asset,
  binding,
  visibility,
  readBytes,
  scenePath,
  posePath,
) {
  const bytes = await readBytes(`${scenePath}/${asset.model}`),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    chunks = new Map();
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw Error("Invalid avatar GLB");
  for (let p = 12; p < bytes.length;) {
    const n = view.getUint32(p, true),
      kind = view.getUint32(p + 4, true);
    if (p + 8 + n > bytes.length || chunks.has(kind))
      throw Error("Invalid avatar GLB chunk");
    chunks.set(kind, bytes.subarray(p + 8, p + 8 + n));
    p += 8 + n;
  }
  const gltf = JSON.parse(new TextDecoder().decode(chunks.get(0x4e4f534a))),
    bin = chunks.get(0x004e4942),
    data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
    cache = new Map(),
    widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
    types = {
      5121: [1, "getUint8", 255],
      5123: [2, "getUint16", 65535],
      5125: [4, "getUint32", 0xffffffff],
      5126: [4, "getFloat32", null],
    };
  function accessor(id) {
    if (cache.has(id)) return cache.get(id);
    const a = gltf.accessors[id],
      v = gltf.bufferViews[a.bufferView],
      [size, getter, max] = types[a.componentType] ?? [],
      width = widths[a.type];
    if (a.sparse || !v || v.buffer !== 0 || !size || !width)
      throw Error("Unsupported avatar accessor");
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const row = [];
      for (let j = 0; j < width; j++) {
        const at =
          (v.byteOffset ?? 0) +
          (a.byteOffset ?? 0) +
          i * (v.byteStride ?? width * size) +
          j * size;
        let value = data[getter](at, true);
        if (a.normalized) value /= max;
        row.push(value);
      }
      out.push(row);
    }
    cache.set(id, out);
    return out;
  }
  const nodes = gltf.nodes.map((n) => {
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
    initial = nodes.map((n) => ({
      p: n.position.clone(),
      q: n.quaternion.clone(),
      s: n.scale.clone(),
    })),
    root = new THREE.Group(),
    joints = new Map(),
    poses = new Map(),
    textures = new Map();
  for (const [i, n] of gltf.nodes.entries())
    for (const child of n.children ?? []) nodes[i].add(nodes[child]);
  for (const i of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[i]);
  root.scale.set(asset.scale, asset.scale, -asset.scale);
  for (const name of binding.catalog.joints) {
    const found = nodes.filter(
      (n) => n.name === THREE.PropertyBinding.sanitizeNodeName(name),
    );
    if (found.length !== 1) throw Error("Avatar joint ambiguous");
    joints.set(name, found[0]);
  }
  for (const file of binding.graph.dependencies("Death")) {
    await readBytes(`${posePath}/${binding.directory}/${file}`);
    poses.set(file, await binding.read(file));
  }
  function texture(index) {
    if (textures.has(index)) return textures.get(index);
    const m = gltf.materials[index],
      pbr = m.pbrMetallicRoughness,
      t = gltf.textures[pbr.baseColorTexture.index],
      im = gltf.images[t.source],
      b = gltf.bufferViews[im.bufferView],
      png = bin.subarray(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength),
      v = new DataView(png.buffer, png.byteOffset, png.byteLength);
    if (im.mimeType !== "image/png" || v.getUint32(0) !== 0x89504e47)
      throw Error("Avatar texture must be embedded PNG");
    const width = v.getUint32(16),
      height = v.getUint32(20),
      pixels = new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${Buffer.from(png).toString("base64")}"/></svg>`,
      ).render().pixels,
      value = {
        width,
        height,
        pixels,
        factor: pbr.baseColorFactor ?? [1, 1, 1, 1],
      };
    textures.set(index, value);
    return value;
  }
  const omitted = new Set(
      Object.keys(asset.unsupportedMaterials).map((n) => n.toLowerCase()),
    ),
    rangeMask = new Map(
      visibility.ranges.map((r) => [r.name.toLowerCase(), r.mask]),
    );
  return {
    triangles(result, mask) {
      for (const [i, n] of nodes.entries()) {
        n.position.copy(initial[i].p);
        n.quaternion.copy(initial[i].q);
        n.scale.copy(initial[i].s);
      }
      for (const layer of result.leaves) {
        const pose = poses.get(layer.file);
        if (!pose) throw Error("Unprepared diagnostic pose");
        for (const track of pose.tracks) {
          const weight =
            (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
          if (!weight) continue;
          const n = joints.get(track.bone),
            sample = sampleAnimationFrame(
              track,
              layer.sourceFrame ?? layer.phase * pose.fps,
            );
          if (track.channel === "quaternion")
            n.quaternion.slerp(
              new THREE.Quaternion()
                .fromArray(sample.a)
                .slerp(
                  new THREE.Quaternion().fromArray(sample.b),
                  sample.fraction,
                ),
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
      const output = [];
      for (const node of gltf.nodes) {
        if (node.mesh === undefined) continue;
        const skin = gltf.skins[node.skin];
        if (!skin) throw Error("Unskinned avatar diagnostic");
        const inverse = accessor(skin.inverseBindMatrices),
          matrices = skin.joints.map((j, i) =>
            new THREE.Matrix4().multiplyMatrices(
              nodes[j].matrixWorld,
              new THREE.Matrix4().fromArray(inverse[i]),
            ),
          );
        for (const primitive of gltf.meshes[node.mesh].primitives) {
          const material = gltf.materials[primitive.material],
            name = material.name.toLowerCase();
          if (!rangeMask.has(name)) throw Error("Unbound diagnostic submesh");
          if (omitted.has(name) || !(mask & rangeMask.get(name))) continue;
          if (primitive.mode !== undefined && primitive.mode !== 4)
            throw Error("Avatar triangles required");
          const positions = accessor(primitive.attributes.POSITION),
            boneIds = accessor(primitive.attributes.JOINTS_0),
            weights = accessor(primitive.attributes.WEIGHTS_0),
            uvs = accessor(primitive.attributes.TEXCOORD_0),
            indices = accessor(primitive.indices).flat(),
            tex = texture(primitive.material),
            vertices = positions.map((p, i) => {
              const v = new THREE.Vector3();
              for (let k = 0; k < 4; k++)
                if (weights[i][k])
                  v.addScaledVector(
                    new THREE.Vector3()
                      .fromArray(p)
                      .applyMatrix4(matrices[boneIds[i][k]]),
                    weights[i][k],
                  );
              return v;
            });
          for (let i = 0; i < indices.length; i += 3) {
            const ids = indices.slice(i, i + 3),
              uv = [0, 1].map(
                (k) => ids.reduce((s, j) => s + uvs[j][k], 0) / 3,
              ),
              x = Math.floor((((uv[0] % 1) + 1) % 1) * tex.width),
              y = Math.floor((((uv[1] % 1) + 1) % 1) * tex.height),
              at = (y * tex.width + x) * 4,
              rgba = Array.from(
                tex.pixels.subarray(at, at + 4),
                (v, k) => v * tex.factor[k],
              );
            if (rgba[3] < 8) continue;
            output.push({
              points: ids.map((j) => vertices[j]),
              color: `rgb(${rgba.slice(0, 3).map(Math.round).join(",")})`,
              opacity: rgba[3] / 255,
            });
          }
        }
      }
      return output;
    },
  };
}

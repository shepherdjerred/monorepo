import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { loadAnimationPoses } from "./load-animation-poses.mjs";
import { sampleAnimationFrame } from "../latest-animation.mjs";
import { sampleLatestDeathPosePreview } from "../latest-lifecycle.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-corpse-policy.mjs <cache>");
const cache = resolve(arg),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  proofPath = `${cache}/research/corpse-policy-comparison.json`,
  proof = await json(proofPath),
  world = await json(`${cache}/public/latest-scene/world.json`),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  asset = world.assets[proof.cases[0].asset],
  bytes = await raw(`${cache}/public/latest-scene/${asset.model}`),
  view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
if (
  view.getUint32(0, true) !== 0x46546c67 ||
  view.getUint32(4, true) !== 2 ||
  view.getUint32(8, true) !== bytes.length
)
  throw Error("Invalid installed GLB");
const chunks = new Map();
for (let p = 12; p < bytes.length;) {
  const n = view.getUint32(p, true),
    kind = view.getUint32(p + 4, true);
  if (p + 8 + n > bytes.length || chunks.has(kind))
    throw Error("Invalid GLB chunk");
  chunks.set(kind, bytes.subarray(p + 8, p + 8 + n));
  p += 8 + n;
}
const gltf = JSON.parse(new TextDecoder().decode(chunks.get(0x4e4f534a))),
  bin = chunks.get(0x004e4942),
  data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength),
  sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
  types = {
    5120: [1, "getInt8", 127],
    5121: [1, "getUint8", 255],
    5122: [2, "getInt16", 32767],
    5123: [2, "getUint16", 65535],
    5125: [4, "getUint32", 0xffffffff],
    5126: [4, "getFloat32", null],
  };
function accessor(id) {
  const a = gltf.accessors[id],
    v = gltf.bufferViews[a.bufferView],
    [size, getter, max] = types[a.componentType] ?? [],
    width = sizes[a.type],
    out = [];
  if (!a || a.sparse || !v || v.buffer !== 0 || !size || !width)
    throw Error("Unsupported GLB accessor");
  for (let i = 0; i < a.count; i++) {
    const row = [];
    for (let j = 0; j < width; j++) {
      const p =
        (v.byteOffset ?? 0) +
        (a.byteOffset ?? 0) +
        i * (v.byteStride ?? width * size) +
        j * size;
      let value = data[getter](p, true);
      if (a.normalized) value = Math.max(-1, value / max);
      row.push(value);
    }
    out.push(row);
  }
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
  root = new THREE.Group();
for (const [i, n] of gltf.nodes.entries())
  for (const child of n.children ?? []) nodes[i].add(nodes[child]);
for (const i of gltf.scenes[gltf.scene ?? 0].nodes) root.add(nodes[i]);
root.scale.set(asset.scale, asset.scale, -asset.scale);
const factory = await loadAnimationPoses(`${cache}/public/latest-scene`),
  binding = await factory.bind(asset),
  poses = new Map();
for (const p of [
  `${cache}/public/latest-scene/${asset.animationGraph}`,
  `${cache}/public/latest-scene/${asset.animationCatalog}`,
  `${cache}/public/latest-animation-poses/manifest.json`,
  `${cache}/public/decoder-16.21-macos/animation-clock.json`,
])
  await raw(p);
for (const file of binding.graph.dependencies("Death")) {
  await raw(
    `${cache}/public/latest-animation-poses/${binding.directory}/${file}`,
  );
  poses.set(file, await binding.read(file));
}
const joints = new Map();
for (const name of binding.catalog.joints) {
  const matches = nodes.filter(
    (n) => n.name === THREE.PropertyBinding.sanitizeNodeName(name),
  );
  if (matches.length !== 1) throw Error("Ambiguous corpse pose joint");
  joints.set(name, matches[0]);
}
const textureCache = new Map();
function material(index) {
  if (textureCache.has(index)) return textureCache.get(index);
  const m = gltf.materials[index],
    pbr = m.pbrMetallicRoughness,
    t = gltf.textures[pbr.baseColorTexture.index],
    im = gltf.images[t.source],
    b = gltf.bufferViews[im.bufferView],
    png = bin.subarray(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength),
    v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (im.mimeType !== "image/png" || v.getUint32(0) !== 0x89504e47)
    throw Error("Corpse diagnostic requires embedded PNG");
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
  textureCache.set(index, value);
  return value;
}
function triangles(c) {
  for (const [i, n] of nodes.entries()) {
    n.position.copy(initial[i].p);
    n.quaternion.copy(initial[i].q);
    n.scale.copy(initial[i].s);
  }
  const result = sampleLatestDeathPosePreview(
    binding.graph,
    {
      dead: true,
      interval: { death: { time: c.deathTime }, postDeathActions: [] },
    },
    c.time,
  );
  for (const layer of result.leaves) {
    const pose = poses.get(layer.file);
    for (const track of pose.tracks) {
      const weight =
        (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
      if (!weight) continue;
      const n = joints.get(track.bone),
        sample = sampleAnimationFrame(
          track,
          layer.sourceFrame === null || layer.sourceFrame === undefined
            ? layer.phase * pose.fps
            : layer.sourceFrame,
        );
      if (track.channel === "quaternion") {
        const q = new THREE.Quaternion()
          .fromArray(sample.a)
          .slerp(new THREE.Quaternion().fromArray(sample.b), sample.fraction);
        n.quaternion.slerp(q, weight);
      } else {
        const v = new THREE.Vector3()
          .fromArray(sample.a)
          .lerp(new THREE.Vector3().fromArray(sample.b), sample.fraction);
        n[track.channel].lerp(v, weight);
      }
    }
  }
  root.updateMatrixWorld(true);
  const output = [];
  for (const [nodeIndex, node] of gltf.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const skin = gltf.skins[node.skin];
    if (!skin) throw Error("Expected skinned minion mesh");
    const inverse = accessor(skin.inverseBindMatrices),
      matrices = skin.joints.map((j, i) =>
        new THREE.Matrix4().multiplyMatrices(
          nodes[j].matrixWorld,
          new THREE.Matrix4().fromArray(inverse[i]),
        ),
      );
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const mat = gltf.materials[primitive.material];
      if (asset.hidden.includes(mat.name)) continue;
      if (primitive.mode !== undefined && primitive.mode !== 4)
        throw Error("Expected minion triangles");
      const positions = accessor(primitive.attributes.POSITION),
        boneIds = accessor(primitive.attributes.JOINTS_0),
        weights = accessor(primitive.attributes.WEIGHTS_0),
        uvs = accessor(primitive.attributes.TEXCOORD_0),
        indices = accessor(primitive.indices).flat(),
        texture = material(primitive.material),
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
          points = ids.map((j) => vertices[j]),
          uv = [0, 1].map((k) => ids.reduce((s, j) => s + uvs[j][k], 0) / 3),
          x = Math.floor((((uv[0] % 1) + 1) % 1) * texture.width),
          y = Math.floor((((uv[1] % 1) + 1) % 1) * texture.height),
          at = (y * texture.width + x) * 4,
          rgba = Array.from(
            texture.pixels.subarray(at, at + 4),
            (v, k) => v * texture.factor[k],
          );
        if (rgba[3] < 8) continue;
        output.push({
          points,
          color: `rgb(${rgba.slice(0, 3).map(Math.round).join(",")})`,
          opacity: rgba[3] / 255,
        });
      }
    }
  }
  return output;
}
const meshes = proof.cases.map((c) =>
    c.retention.visible ? triangles(c) : [],
  ),
  all = meshes.flatMap((m) => m.flatMap((t) => t.points)),
  bounds = new THREE.Box3().setFromPoints(all),
  center = bounds.getCenter(new THREE.Vector3()),
  radius = bounds.getSize(new THREE.Vector3()).length(),
  camera = new THREE.OrthographicCamera(
    -radius,
    radius,
    radius,
    -radius,
    0.1,
    radius * 20,
  );
camera.position
  .copy(center)
  .add(new THREE.Vector3(1.3, 1.2, 1.7).multiplyScalar(radius));
camera.lookAt(center);
camera.updateMatrixWorld();
const projected = meshes.map((m) =>
    m.map((t) => ({
      ...t,
      points: t.points.map((p) => p.clone().project(camera)),
    })),
  ),
  xy = projected.flatMap((m) => m.flatMap((t) => t.points)),
  minX = Math.min(...xy.map((p) => p.x)),
  maxX = Math.max(...xy.map((p) => p.x)),
  minY = Math.min(...xy.map((p) => p.y)),
  maxY = Math.max(...xy.map((p) => p.y)),
  scale = Math.min(430 / (maxX - minX), 220 / (maxY - minY)),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    ),
  parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1660" height="1160"><rect width="1660" height="1160" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">',
    '<text x="50" y="62" font-size="34" font-weight="bold">Minion corpses now retire at their native lifetime</text>',
    `<text x="50" y="104" font-size="19" fill="#9cb1c4">${esc(proof.cases[0].asset)} · recorded death at ${proof.cases[0].deathTime.toFixed(3)}s · fixed diagnostic camera</text>`,
    '<text x="50" y="137" font-size="19" fill="#9cb1c4">The native condition is age strictly greater than lifetime. Names and HP bars stay hidden while dead.</text>',
  ];
for (const [i, c] of proof.cases.entries()) {
  const x = 50 + (i % 3) * 535,
    y = 170 + Math.floor(i / 3) * 410,
    visible = c.retention.visible,
    color = visible ? "#59d9b3" : "#e39b8d";
  parts.push(
    `<rect x="${x}" y="${y}" width="510" height="380" rx="10" fill="#11232d" stroke="#29424f"/><text x="${x + 22}" y="${y + 37}" font-size="24" font-weight="bold">${esc(c.label)}</text><text x="${x + 22}" y="${y + 67}" font-size="17" fill="${color}">${esc(c.retention.status)} · ${c.time.toFixed(3)}s</text>`,
  );
  if (visible) {
    for (const t of projected[i].sort(
      (a, b) =>
        b.points.reduce((s, p) => s + p.z, 0) -
        a.points.reduce((s, p) => s + p.z, 0),
    )) {
      const points = t.points
        .map(
          (p) =>
            `${(x + 255 + (p.x - (minX + maxX) / 2) * scale).toFixed(2)},${(y + 208 - (p.y - (minY + maxY) / 2) * scale).toFixed(2)}`,
        )
        .join(" ");
      parts.push(
        `<polygon points="${points}" fill="${t.color}" opacity="${t.opacity.toFixed(3)}"/>`,
      );
    }
  } else
    parts.push(
      `<text x="${x + 255}" y="${y + 212}" text-anchor="middle" font-size="22" fill="#78909d">Model hidden</text>`,
    );
  parts.push(
    `<text x="${x + 22}" y="${y + 347}" font-size="17" fill="#9cb1c4">${visible ? "Death pose preview; corpse retained" : "Historical unit state remains dead and inspectable"}</text>`,
  );
}
parts.push(
  `<text x="50" y="1040" font-size="20">${proof.counts.deathChecks} minion deaths · ${proof.counts.clockChecks} native timing probes · ${proof.counts.reverseSeekChecks.toLocaleString()} reverse-seek visibility checks</text>`,
  '<text x="50" y="1080" font-size="17" fill="#9cb1c4">Software projection of the installed mesh and shared Death pose; textures use triangle samples. This is not a WebGL capture.</text>',
  '<text x="50" y="1115" font-size="17" fill="#9cb1c4">Live-clock scheduling, native death animation/fading, champion cleanup and League A/V comparison remain unverified.</text></g></svg>',
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-corpse-policy`;
await Bun.write(`${out}.svg`, svg);
await Bun.write(`${out}.png`, png);
await Bun.write(
  `${out}.json`,
  JSON.stringify(
    {
      schema: 1,
      comparisonSha256: inputs[proofPath],
      rendererSha256: sha(await raw(import.meta.path)),
      inputs,
      imageSha256: sha(png),
      svgSha256: sha(svg),
      triangles: meshes.map((m) => m.length),
      counts: proof.counts,
      scope: {
        ...proof.scope,
        softwareMeshProjection: true,
        actualWebGlCapture: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    image: `${out}.png`,
    imageSha256: sha(png),
    triangles: meshes.map((m) => m.length),
  }),
);

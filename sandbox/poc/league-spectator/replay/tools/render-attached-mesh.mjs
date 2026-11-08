import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "../../../packages/report/node_modules/@resvg/resvg-js/index.js";
import { loadAnimationPoses } from "./load-animation-poses.mjs";
import { loadSoftwareAvatar } from "./software-avatar.mjs";
import { sampleLatestDeathPosePreview } from "../latest-lifecycle.mjs";
import { createLatestAttachedMeshBindings } from "../latest-attached-mesh.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: render-attached-mesh.mjs <cache>");
const cache = resolve(arg),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  proofPath = `${cache}/research/attached-mesh-comparison.json`,
  proof = await json(proofPath),
  scenePath = `${cache}/public/latest-scene`,
  posePath = `${cache}/public/latest-animation-poses`,
  sceneBytes = await raw(`${scenePath}/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  c = proof.example,
  asset = scene.champions[c.asset],
  factory = await createLatestAttachedMeshBindings(
    await json(`${cache}/public/decoder-16.21-macos/profile.json`),
    sceneBytes,
    await raw(`${cache}/public/latest-submesh-visibility/package.json`),
    await raw(`${cache}/public/latest-effects/manifest.json`),
    await raw(`${cache}/public/latest-attached-mesh/package.json`),
  ),
  resource = await factory.createResource(
    asset,
    await raw(`${scenePath}/${asset.model}`),
    await raw(`${scenePath}/${asset.animationGraph}`),
  ),
  poseFactory = await loadAnimationPoses(scenePath),
  binding = await poseFactory.bind(asset),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  avatar = await loadSoftwareAvatar(
    THREE,
    asset,
    binding,
    { ranges: factory.ranges(resource) },
    raw,
    scenePath,
    posePath,
  ),
  pose = sampleLatestDeathPosePreview(
    binding.graph,
    {
      dead: true,
      interval: { death: { time: c.deathTime }, postDeathActions: [] },
    },
    c.time,
  ),
  body = c.layers.find((l) => l.emitterIndex === 15),
  hair = c.layers.find((l) => l.emitterIndex === 16),
  cases = [
    { label: "Skin visibility after death", mask: c.mask },
    { label: "Attached body layer · forced draw", mask: body.mask },
    { label: "Attached hair layer · forced draw", mask: hair.mask },
    {
      label: "Body and hair selections combined",
      mask: (body.mask | hair.mask) >>> 0,
    },
  ],
  meshes = cases.map((v) => avatar.triangles(pose, v.mask)),
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
  scale = Math.min(590 / (maxX - minX), 280 / (maxY - minY)),
  parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1250"><rect width="1600" height="1250" fill="#09131d"/><g font-family="Arial" fill="#e4edf4">',
    '<text x="50" y="62" font-size="34" font-weight="bold">Recovering Viego’s replacement death mesh</text>',
    '<text x="50" y="106" font-size="20" fill="#9cb1c4">Native attached-effect masks can redraw body parts hidden by the death animation.</text>',
    '<text x="50" y="142" font-size="18" fill="#e8c487">Geometry selection diagnostic · supplied shared death pose · owner textures identify parts; effect materials are not applied.</text>',
  ];
for (const [i, s] of cases.entries()) {
  const x = 50 + (i % 2) * 770,
    y = 180 + Math.floor(i / 2) * 435;
  parts.push(
    `<rect x="${x}" y="${y}" width="730" height="410" rx="10" fill="#11232d" stroke="#29424f"/><text x="${x + 24}" y="${y + 39}" font-size="24" fill="#59d9b3">${s.label}</text><text x="${x + 24}" y="${y + 72}" font-size="18" fill="#9cb1c4">Viego skin 43 · mask 0x${s.mask.toString(16)}</text>`,
  );
  for (const t of projected[i].sort(
    (a, b) =>
      b.points.reduce((s, p) => s + p.z, 0) -
      a.points.reduce((s, p) => s + p.z, 0),
  )) {
    const points = t.points
      .map(
        (p) =>
          `${(x + 365 + (p.x - (minX + maxX) / 2) * scale).toFixed(2)},${(y + 235 - (p.y - (minY + maxY) / 2) * scale).toFixed(2)}`,
      )
      .join(" ");
    parts.push(
      `<polygon points="${points}" fill="${t.color}" opacity="${t.opacity.toFixed(3)}"/>`,
    );
  }
  if (!meshes[i].length)
    parts.push(
      `<text x="${x + 365}" y="${y + 235}" font-size="23" text-anchor="middle" fill="#78909d">No skin submeshes visible</text>`,
    );
  parts.push(
    `<text x="${x + 24}" y="${y + 382}" font-size="18" fill="#9cb1c4">${meshes[i].length.toLocaleString()} textured triangles · geometry preview only</text>`,
  );
}
parts.push(
  `<text x="50" y="1106" font-size="21">181 prepared attached emitters · ${proof.counts.drawMaskChecks.toLocaleString()} native mask comparisons in each of two draw paths</text>`,
  '<text x="50" y="1148" font-size="18" fill="#9cb1c4">Software projection with triangle texture samples; this is not a rendered death effect or browser capture.</text>',
  '<text x="50" y="1184" font-size="18" fill="#9cb1c4">Particle timing, owner/pose binding, effect shaders and main-viewer integration remain unimplemented for this component.</text>',
  '<text x="50" y="1220" font-size="18" fill="#9cb1c4">Matching League A/V comparison remains unavailable.</text></g></svg>',
);
const svg = parts.join(""),
  png = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng(),
  out = `${cache}/public/evidence/latest-attached-mesh`;
await Bun.write(`${out}.svg`, svg);
await Bun.write(`${out}.png`, png);
await raw(`${import.meta.dir}/software-avatar.mjs`);
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
        softwareMeshSelectionProjection: true,
        actualWebGlCapture: false,
        deathVfxRendered: false,
        effectMaterialsApplied: false,
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

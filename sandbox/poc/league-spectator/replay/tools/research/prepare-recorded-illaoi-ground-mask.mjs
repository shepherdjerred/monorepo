import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const [
  base,
  nativePath,
  navSourcePath,
  texturePath,
  maskPath,
  vertexPath,
  fragmentPath,
  requested,
] = process.argv.slice(2);
assert(
  process.argv.length === 10 && requested,
  "Usage: bun prepare-recorded-illaoi-ground-mask.mjs V64_TRACK NATIVE120 NAV_SOURCE TEXTURE_PNG HIGH_MASK_R8 MASKED_VERTEX_GLSL MASKED_FRAGMENT_GLSL NEW_CACHE_DIRECTORY",
);
const output = resolve(requested);
const outputParent = relative(
  await realpath(".cache"),
  await realpath(dirname(output)),
);
assert(
  !isAbsolute(outputParent) && outputParent.split(/[\\/]/u, 1)[0] !== "..",
);

const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
async function checked(path, expected) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), expected, `Unreviewed input ${path}`);
  return bytes;
}
const checkedJson = async (path, digest) =>
  JSON.parse(await checked(path, digest));
const textureDigest =
  "77fe7d5cb87d81abbb080dc57dc446e311699df17cc0910d7e815016f6d9d3e4";
const maskDigest =
  "d5f5349b43cdd0a52ae768c01272280e031ddfbca8eb07d12a63dfbb14917846";
const vertexDigest =
  "2e1c3da859ac5ef9a2e5c63a72b39c61b3f8d076b9113bd8772c703cd6c6f177";
const fragmentDigest =
  "e23b81ea1667fb2738c1c3746916d5a93c017911bdee8f4cc908517fabf13266";
const [track, native, navSource, textureBytes, maskBytes, vertex, fragment] =
  await Promise.all([
    checkedJson(
      join(base, "recorded-particles.json"),
      "b90669a58367eff4f2253a4fff49d7c4993558556d6c1a16749a7ada5b1ecf4d",
    ),
    checkedJson(
      nativePath,
      "980c457875defa1466cc1c81bc2506c1b6b7b493eab34965d5a979e3fa4e803d",
    ),
    checkedJson(
      navSourcePath,
      "50dfc586230dc24ed242fdcf120f5298772357ae7ded4e4bc56140bfab36e2e7",
    ),
    checked(texturePath, textureDigest),
    checked(maskPath, maskDigest),
    checked(vertexPath, vertexDigest),
    checked(fragmentPath, fragmentDigest),
  ]);

assert.equal(track.schema, 5);
assert.equal(track.build, native.build);
assert.equal(track.build, navSource.build);
assert.equal(track.replaySha256, native.replaySha256);
assert.equal(native.component, "Ground_SLOW2");
assert.equal(native.writerRva, 0x175b1f0);
assert.equal(native.cadence, 120);
const { width, height } = navSource.expanded;
assert.deepEqual([width, height], [1180, 1184]);
assert.equal(maskBytes.length, width * height);
const { xScale, zScale, xBias, zBias } = navSource.worldToUv;
const { handle, stamp: start } = native.event;
const { request, age: stopAge } = native.stopControl;
const end = request.stamp;
assert.equal(request.route, "direct-stop");
assert.equal(request.target, handle);
assert.equal(stopAge, end - start);
assert.equal(native.stopControl.nativeWrapperStopBytes, "0808");
assert.equal(native.stopControl.renderSystemUvUnchanged, true);
assert.equal(handle, 1073820744);
assert.equal(start, 1712.7284140625);
assert.equal(end, 1714.7334140625);
assert(!track.effects.some((effect) => effect.handle === handle));

const indices = "000001000200000002000300040005000600040006000700";
const quadUvs = [
  [0, 0],
  [0x3c00, 0],
  [0x3c00, 0x3c00],
  [0, 0x3c00],
];
assert.equal(native.timeline.length, 242);
assert.equal(native.timeline.at(-1)[0], stopAge);
const samples = native.timeline.slice(0, -1).map(([age, count, data], tick) => {
  assert.equal(age, tick / native.cadence);
  assert(age < stopAge);
  assert.equal(count, 2);
  assert.equal(data.vertices, 8 * 28);
  assert.equal(data.indices, 12 * 2);
  assert.equal(data.indexBytes, indices);
  assert.match(data.vertexBytes, /^[a-f0-9]{448}$/u);
  const vertices = Buffer.from(data.vertexBytes, "hex");
  for (let vertex = 0; vertex < 8; vertex++) {
    const uv = vertex * 28 + 16;
    assert.deepEqual(
      [vertices.readUInt16LE(uv), vertices.readUInt16LE(uv + 2)],
      quadUvs[vertex % 4],
    );
  }
  return { age, indices: data.indexBytes, vertices: data.vertexBytes };
});
const assetPath = (digest, ext) => `recorded-particles/${digest}.${ext}`;
const texture = assetPath(textureDigest, "png");
const palette = assetPath(
  "9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a",
  "png",
);
const mask = { path: assetPath(maskDigest, "r8"), width, height };
const vertexShader = assetPath(vertexDigest, "glsl");
const fragmentShader = assetPath(fragmentDigest, "glsl");
assert(track.textures.files.includes(palette));
assert(!track.textures.files.includes(texture));
const inheritedPaths = new Set([
  ...track.textures.files,
  ...Object.values(track.shaders),
]);
const inherited = await Promise.all(
  Array.from(inheritedPaths, async (path) => {
    const digest = /^recorded-particles\/([a-f0-9]{64})\.(?:glsl|png)$/u.exec(
      path,
    )?.[1];
    assert(digest, `Unreviewed inherited dependency ${path}`);
    return [path, await checked(join(base, path), digest)];
  }),
);

const manifest = JSON.stringify({
  ...track,
  schema: 6,
  textures: { files: [...track.textures.files, texture] },
  worldMaskedQuad: {
    texture,
    palette,
    mask,
    vertexShader,
    fragmentShader,
    worldToUv: [xScale, zScale, xBias, zBias],
    paths: [{ handle, start, end, samples }],
  },
});
await mkdir(output);
await mkdir(join(output, "recorded-particles"));
const assets = [
  ...inherited,
  [texture, textureBytes],
  [mask.path, maskBytes],
  [vertexShader, vertex],
  [fragmentShader, fragment],
];
await Promise.all(
  assets.map(([path, bytes]) =>
    writeFile(join(output, path), bytes, { flag: "wx" }),
  ),
);
await writeFile(join(output, "recorded-particles.json"), manifest, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    output,
    sha256: sha256(manifest),
    handle,
    start,
    end,
    samples: samples.length,
  }),
);

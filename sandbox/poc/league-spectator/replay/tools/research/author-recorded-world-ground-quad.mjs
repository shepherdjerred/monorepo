// Rebuild the reviewed detached Maokai E quad from offline native and WAD inputs.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { openLocalWad } from "../wad.mjs";

const usage =
  "Usage: bun author-recorded-world-ground-quad.mjs <installation> <TerrainTextureMips.dll> <primary native receipt> <alternate native receipt> <base schema-6 track JSON or gzip> <fresh .cache output directory>";
const [
  installation,
  converter,
  primary,
  alternate,
  baseTrack,
  output,
  ...extra
] = process.argv.slice(2);
assert(
  installation &&
    converter &&
    primary &&
    alternate &&
    baseTrack &&
    output &&
    !extra.length,
  usage,
);
const out = resolve(output);
const privatePath = relative(resolve(".cache"), out);
assert(
  privatePath &&
    privatePath !== ".." &&
    !privatePath.startsWith(".." + sep) &&
    resolve(".cache", privatePath) === out,
);
const sha = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const native = await readFile(primary);
assert.equal(
  sha(native),
  "c1150d08d9d81072c1048ba09b3b2f5eda44014a8dc5e992d69d3b33ac9630ec",
  "Native geometry receipt differs from the reviewed sample",
);
assert.deepEqual(native, await readFile(alternate));
const receipt = JSON.parse(native);
const [{ event, cases, sourceSha256, emitter }] = receipt.systems;
assert.equal(receipt.systems.length, 1);
const native120 = cases.filter(({ cadence }) => cadence === 120);
assert.equal(native120.length, 2);
const geometry = native120[0].geometry;
const cutoff = 0.5500000715255737;
for (const condition of cases) {
  assert.equal(condition.firstEmptyFloat32Age, cutoff);
  assert.equal(condition.lastLiveAge, 0.550000011920929);
  assert.equal(condition.worldScale, event.descriptor.scaleRate[0]);
  for (const [age, frame] of condition.geometry)
    assert.deepEqual(
      frame,
      geometry.find(([sampleAge]) => sampleAge === age)?.[1],
    );
}

const wad = await openLocalWad(
  installation,
  "DATA/FINAL/Champions/Maokai.wad.client",
  Bun.zstdDecompressSync,
  "34823fe3140f0d1d78466af61c3021fd525228da32f370aa96b580fd4f7c1ab3",
);
const source = await wad(
  "data/characters/maokai/maokai_multi_skins_skin33_skins_skin34.bin",
);
assert.equal(sha(source), sourceSha256);
const [definition] = readExactMapBin(source).objects.filter(
  ({ pathHash }) => pathHash === "90a2a563",
);
const [component] = definition.fields["868eb76a"].elements.filter(
  ({ fields }) => fields["3d25b8ce"].value === emitter,
);
const rawTexture = await wad(component.fields["3c6468f4"].value.toLowerCase());
assert.equal(
  sha(rawTexture),
  "1d84b22934f685da35ba7a7374484b0ee0287e0c0fdc86eeb9c15817db0b6ca7",
);

const palette =
  "recorded-particles/9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a.png";
const texture =
  "recorded-particles/da843215267b2ff311adb960c166b3b57138c2ae857f8fc7fa4450547593e17b.png";
const baseBytes = await readFile(baseTrack);
const track = JSON.parse(
  baseBytes[0] === 0x1f && baseBytes[1] === 0x8b
    ? gunzipSync(baseBytes)
    : baseBytes,
);
assert.equal(track.kind, "recorded-native-terrain-particles");
assert.equal(track.schema, 6);
assert.equal(track.build, receipt.build);
assert.equal(track.replaySha256, receipt.replaySha256);
assert.equal(
  track.shaders.vertex,
  "recorded-particles/c9d94bb152fac1036a46871248ae3d310b6b47e178f4cb70cac44d55569dce97.glsl",
);
assert.equal(
  track.shaders.noAlphaTestFragment,
  "recorded-particles/4575577f5b92d40b5c45ab9e43b609d0b8d9d1e8455c595aae98432cd2c6c0dd.glsl",
);
assert(track.textures.files.includes(palette));
assert(!track.textures.files.includes(texture));
assert(
  !Object.hasOwn(track, "worldUnmaskedQuad"),
  "The base track already has unmasked world geometry",
);

const [x, y, z] = event.descriptor.positions[0];
const samples = [];
for (const [age, [indices, vertices]] of geometry) {
  if (age === 0) continue; // The track accepts positive age samples.
  assert(age > (samples.at(-1)?.age ?? 0) && age < cutoff);
  assert.equal(indices, "000001000200000002000300");
  assert.match(vertices, /^[0-9a-f]{224}$/);
  const bytes = Buffer.from(vertices, "hex");
  for (const offset of [0, 28, 56, 84]) {
    assert(Math.abs(bytes.readFloatLE(offset) - x) < 650);
    assert(Math.abs(bytes.readFloatLE(offset + 4) - y - 12.5) < 0.01);
    assert(Math.abs(bytes.readFloatLE(offset + 8) - z) < 650);
  }
  samples.push({ age, vertices, indices });
}
const { handle, stamp: start } = event;
const paths = [{ handle, start, end: start + cutoff, samples }];
const worldUnmaskedQuad = { texture, palette, depthTest: false, paths };
const fragment = JSON.stringify({ worldUnmaskedQuad }, null, 2) + "\n";
assert.equal(
  sha(fragment),
  "f1260a3a580636c5dae1abf743b6e98e4f4000ff73c429f712b8eceeabe59c8d",
);

await mkdir(out);
const texPath = join(out, "authored.tex");
const pngPath = join(out, texture);
const job = join(out, "mip-jobs.json");
await mkdir(join(out, "recorded-particles"));
await writeFile(texPath, rawTexture);
await writeFile(job, JSON.stringify({ [texPath]: pngPath }));
const render = Bun.spawnSync(["dotnet", resolve(converter), job]);
assert.equal(render.exitCode, 0, render.stderr.toString());
assert.deepEqual(JSON.parse(render.stdout.toString())[texPath], {
  mipLevel: 0,
  width: 128,
  height: 128,
});
assert.equal(
  sha(await readFile(pngPath)),
  texture.split("/")[1].slice(0, -4),
  "Native mip conversion bytes differ",
);
await writeFile(join(out, "world-unmasked-quad.json"), fragment);
track.worldUnmaskedQuad = worldUnmaskedQuad;
track.textures.files.push(texture);
await writeFile(
  join(out, "recorded-particles.json"),
  JSON.stringify(track) + "\n",
);
console.log(
  JSON.stringify({
    handle,
    start,
    end: start + cutoff,
    samples: samples.length,
    fragmentSha256: sha(fragment),
    texture,
  }),
);

import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const build = "16.23.841.8428";
const replaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const resourceDirectory = "recorded-particles";
const indices = "000001000200000002000300";
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const receiptHashes = {
  placements:
    "45ccf6bcd764a79a3dcf4f38050cc32fcb804c19d087bdf5237ef3fa84878af2",
  flash: "529013f9cd79902ecd5f55d28c08cd97d7192726e39c1cddd7381cda0e7e688e",
  bubble: "226097a33606304c46ae50577ccdadbc90468f96fda930b03a18dd081591fffc",
  vertex: "6809fb4a64b928575ded4a01dbdcb50b66a78b01baf79dde46206bfb8964a462",
  pixel: "f603c39a5d8edb7c6d47b073e6a79cf3a6fc77f3228a7f27595070df6439b8f5",
};
const textureSources = [
  {
    path: "ASSETS/Shared/Particles/color-firemissile.tex",
    size: 64,
    original:
      "5128e7aea68b7e89d058bb3e61c82974807826d03cc3dd6bfff5bf5638a16179",
    png: "c23e325cc59c7b6aa50a333e61fda6ae676022fd51a1a0eb54c75ccad3a9d84f",
  },
  {
    path: "ASSETS/Characters/Heimerdinger/Skins/Base/Particles/Heimerdinger_Base_AA_Tar.tex",
    size: 256,
    original:
      "4686080e057779023485362c93e7d76aa719d440edb9bcd85adffc2a77d6c5be",
    png: "a177eee4d856d39db66d579c806ce0fe3cfc72063069860fdb74d2e53a1632d9",
  },
  {
    path: "ASSETS/Characters/Heimerdinger/Skins/Base/Particles/Heimerdinger_Base_W_Tar_Bubble.tex",
    size: 256,
    original:
      "90e184c1967a81ca2424a1ec73275f379debcfcddd9b5ecc0b1d15da6b96325a",
    png: "13678fbc62c31d02bc3ae0f66f92ad03b8a25ff87f22d0e23180ced7189a57c1",
  },
];

async function readReceipt(path, key) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(sha256(bytes), receiptHashes[key], `Unreviewed ${key} receipt`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function compileEffects(placements) {
  assert.equal(placements.length, 7);
  return placements
    .map(({ stamp, handle, owner, context, descriptor }) => {
      assert.equal(owner, 0x40000151);
      assert.equal(context, 0);
      assert.equal(descriptor.resourceKey, 0x0fb3cb06);
      assert.equal(descriptor.flags, 0x20);
      assert.deepEqual(descriptor.scaleRate, [1, 1]);
      const [position, secondary, unused] = descriptor.positions;
      assert.equal(position.length, 3);
      assert.ok(position.every(Number.isFinite));
      assert.deepEqual(position, secondary);
      assert.deepEqual(unused, [0, 0, 0]);
      assert.ok(Number.isFinite(stamp) && stamp > 0);
      assert.ok(Number.isInteger(handle) && handle > 0 && handle <= 0xffffffff);
      return { handle, start: stamp, position };
    })
    .sort((a, b) => a.start - b.start || a.handle - b.handle);
}

function compileComponent(receipt, texture, expectedLifetime) {
  const [insertion] = receipt.inserts;
  assert.equal(receipt.inserts.length, 1);
  assert.equal(insertion.birthClock, 0);
  assert.equal(insertion.lifetime, expectedLifetime);
  assert.deepEqual(insertion.position, [0, 100, 0]);
  assert.deepEqual(insertion.scale, [100, 100, 100]);
  const samples = [];
  for (const [age, count, geometry] of receipt.timeline) {
    // The initializer and the terminal degenerate quad do not establish a
    // visible frame. Positive-age retained samples preserve the original bytes.
    if (age === 0 || Math.fround(age) >= insertion.lifetime) continue;
    assert.ok(Number.isFinite(age) && age > (samples.at(-1)?.age ?? 0));
    assert.equal(count, 1);
    assert.equal(geometry.indices, 12);
    assert.equal(geometry.indexBytes, indices);
    assert.equal(geometry.vertices, 112);
    assert.match(geometry.vertexBytes, /^[a-f0-9]{224}$/);
    samples.push({ age, vertices: geometry.vertexBytes });
  }
  assert.equal(samples.length, 7);
  return { texture, indices, samples, lifetime: insertion.lifetime };
}

async function readTextures(receiptPath) {
  const receipt = await Bun.file(receiptPath).json();
  assert.equal(receipt.length, textureSources.length);
  return Promise.all(
    textureSources.map(async (expected, index) => {
      const row = receipt[index];
      assert.equal(row.texture, expected.path);
      assert.equal(row.width, expected.size);
      assert.equal(row.height, expected.size);
      assert.equal(row.mipLevel, 0);
      assert.equal(row.originalSha256, expected.original);
      assert.equal(row.pngSha256, expected.png);
      // The receipt records absolute paths on its producer. Read the reviewed
      // sibling filenames so a copied receipt works on another machine.
      const bytes = await Bun.file(
        join(dirname(receiptPath), `${index}.png`),
      ).bytes();
      assert.equal(
        sha256(bytes),
        expected.png,
        `Unreviewed texture ${row.texture}`,
      );
      return { path: `${resourceDirectory}/${expected.png}.png`, bytes };
    }),
  );
}

function shaderResource({ glsl }) {
  assert.ok(glsl.startsWith("#version 300 es\n"));
  const bytes = new TextEncoder().encode(glsl);
  return { path: `${resourceDirectory}/${sha256(bytes)}.glsl`, bytes };
}

const inputNames = [
  "placements",
  "flash",
  "bubble",
  "textures",
  "vertex",
  "pixel",
  "out",
];
const { values } = parseArgs({
  options: Object.fromEntries(
    inputNames.map((name) => [name, { type: "string" }]),
  ),
});
for (const name of inputNames)
  assert.ok(values[name]?.length, `--${name} is required`);
const [placements, flash, bubble, textures, vertex, pixel] = await Promise.all([
  readReceipt(values.placements, "placements"),
  readReceipt(values.flash, "flash"),
  readReceipt(values.bubble, "bubble"),
  readTextures(values.textures),
  readReceipt(values.vertex, "vertex").then(shaderResource),
  readReceipt(values.pixel, "pixel").then(shaderResource),
]);
const effects = compileEffects(placements);
assert.equal(new Set(effects.map(({ handle }) => handle)).size, effects.length);
const manifest = {
  schema: 1,
  kind: "recorded-native-terrain-particles",
  build,
  replaySha256,
  status: "verified-partial-effects",
  scope: "native-sampled-cold-remap",
  effects,
  components: [
    compileComponent(flash, textures[1].path, Math.fround(0.2)),
    compileComponent(bubble, textures[2].path, Math.fround(0.3)),
  ],
  textures: {
    palette: textures[0].path,
    files: textures.map(({ path }) => path),
  },
  shaders: { vertex: vertex.path, fragment: pixel.path },
};
// The private player translates the recorded local quads by each packet's
// world position. The cold remap, sampled geometry, and archived texture proof
// do not establish the active match remap, whole factory, or other effects.
const output = resolve(values.out);
await Promise.all(
  [...textures, vertex, pixel].map(({ path, bytes }) =>
    Bun.write(join(output, path), bytes, { createPath: true }),
  ),
);
await Bun.write(
  join(output, "recorded-particles.json"),
  JSON.stringify(manifest),
);

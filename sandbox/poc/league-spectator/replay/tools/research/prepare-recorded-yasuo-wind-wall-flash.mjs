import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const [base, eventSource, stopSource, controls, png, destination] =
  process.argv.slice(2);
assert(
  process.argv.length === 8 && destination,
  "Usage: bun prepare-recorded-yasuo-wind-wall-flash.mjs V66_TRACK YASUO_SOURCE STOP_SOURCE NATIVE_RECEIPT_DIRECTORY TEXTURE_PNG NEW_CACHE_DIRECTORY",
);
const output = resolve(destination);
const outputParent = relative(
  await realpath(".cache"),
  await realpath(dirname(output)),
);
assert(
  !isAbsolute(outputParent) && outputParent.split(/[\\/]/u, 1)[0] !== "..",
);

const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
async function checked(path, digest) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), digest, `Unreviewed input ${path}`);
  return bytes;
}
const json = async (path, digest) => JSON.parse(await checked(path, digest));
const native = async (file, digest) => {
  const path = join(controls, file);
  const bytes = await readFile(path);
  const content = bytes.toString("utf8").replace(/\r?\n$/u, "");
  assert.equal(sha256(content), digest, `Unreviewed native receipt ${path}`);
  return JSON.parse(content);
};
const eventDigest =
  "ad2db3f0980ece3118bea353302bdc126caf63aa0082dfe64da53ac206557d73";
const textureDigest =
  "3a6f6646121c4881b8df499088f5d4b99f76b0369a44852a893538caaa8363e3";
const [track, source, stop, textureBytes] = await Promise.all([
  json(
    join(base, "recorded-particles.json"),
    "59d776edc8ce98ed425c440d34774f2b9a9b05f7a3051a56170b51d9d45caa6e",
  ),
  json(eventSource, eventDigest),
  json(
    stopSource,
    "3f737589cb975f16b207fd47588c92d763b3b01079307576bc641c7e1ff5ebb3",
  ),
  checked(png, textureDigest),
]);
assert.equal(track.schema, 6);
assert.equal(track.build, stop.build);
assert.equal(track.replaySha256, stop.replaySha256);
assert.equal(source.key, "82234fd3");
assert.equal(source.events.length, 4);

const seeds = new Map([
  [
    1073820923,
    "ea4fc607fbf993c4d88755298d0ef0d2d40f9feb0f0e764f9bef9866176f69f4",
  ],
  [
    1073820924,
    "92b16a6c8bbbd520c7a5c0bf2c4277ce1f1e9b3c079fbe2e6bd8cd2a42df01e6",
  ],
  [
    1073820962,
    "55289b6c342e564362ac01885020865146663cdd4c6e1413c5481697c727b2ec",
  ],
  [
    1073821375,
    "6bce66f14035ad09e1920ff597554e5e687503bc0154a9fcc8345ff034b6a2f8",
  ],
]);
const texture = `recorded-particles/${textureDigest}.png`;
// The original empty-name palette is a generated opaque white texel.
const palette =
  "recorded-particles/9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a.png";
assert(track.textures.files.includes(palette));
assert(!track.textures.files.includes(texture));
const indices = "000001000200000002000300";
function compileNative(receipt) {
  assert.equal(receipt.archiveSha256, stop.executableSha256);
  assert.equal(receipt.authoredSha256, eventDigest);
  assert.deepEqual(receipt.material, {
    pass: 4,
    descriptorHex:
      "3f0000000503000000000606010100010f000000000000000000000000000000",
    parameters: [
      ["ALPHA_TEST", 1],
      ["AlphaTestReferenceValue", [Math.fround(5 / 255), 0, 0, 0]],
    ],
    stages: ["ParticleSystem/QUAD_PS.ps", "ParticleSystem/QUAD_VS.vs"],
    defineCount: 0,
    requestFlagsHex: "00000000000000000000",
  });
  const [insertion] = receipt.inserts;
  assert.equal(receipt.inserts.length, 1);
  assert.deepEqual(insertion.position, [0, 0, 0]);
  assert.equal(insertion.birthClock, 0);
  const { lifetime } = insertion;
  assert(lifetime > 0.16 && lifetime < 0.23);
  const samples = [];
  for (const [tick, [age, count, geometry]] of receipt.timeline.entries()) {
    assert.equal(age, tick / 120);
    if (age >= lifetime) {
      assert.equal(count, 0);
      assert.equal(geometry, null);
      continue;
    }
    assert.equal(count, 1);
    assert.equal(geometry.indexBytes, indices);
    assert.match(geometry.vertexBytes, /^[a-f0-9]{224}$/u);
    const bytes = Buffer.from(geometry.vertexBytes, "hex");
    assert.deepEqual(
      [16, 44, 72, 100].map((offset) =>
        bytes.subarray(offset, offset + 4).toString("hex"),
      ),
      ["00000000", "003c0000", "003c003c", "0000003c"],
    );
    for (const offset of [0, 28, 56, 84])
      assert.equal(bytes.readFloatLE(offset + 8), 0);
    if (age > 0) samples.push({ age, vertices: geometry.vertexBytes });
  }
  assert(receipt.timeline.at(-1)[0] > lifetime);
  return { lifetime, samples };
}
const [low, high] = await Promise.all(
  [
    [
      "0.125",
      "054f61be806904190a503505281b54cb1b0d5e0286ecc757d3f37d5ea5be0b0d",
    ],
    [
      "0.875",
      "037cba088d6a0eb97825f6a4c2966686fba95b547b83c7a7a6ddd577b22584b9",
    ],
  ].map(async ([lane, digest]) => {
    const receipt = await native(`yasuo-flash-${lane}-1073820923.json`, digest);
    assert.equal(receipt.handle, 1073820923);
    assert.equal(receipt.seedHex, null);
    assert(receipt.rngSamples.every((sample) => sample === Number(lane)));
    return compileNative(receipt);
  }),
);
assert(low.lifetime < high.lifetime);
assert.notEqual(low.samples[4].vertices, high.samples[4].vertices);

const entries = await Promise.all(
  source.events.map(async (event) => {
    const { handle, stamp: start } = event;
    const digest = seeds.get(handle);
    assert(digest);
    const receipt = await native(`yasuo-flash-seeded-${handle}.json`, digest);
    assert.equal(receipt.handle, handle);
    const seed = Buffer.from(
      sha256(`${track.replaySha256}:${handle}`).slice(0, 16),
      "hex",
    );
    assert.equal(receipt.seedHex, seed.reverse().toString("hex"));
    const { lifetime, samples } = compileNative(receipt);
    assert.equal(event.owner, 1073742163);
    assert.equal(event.parent, 0);
    assert.equal(event.context, 0);
    assert.equal(event.status, "detached-placement-confirmed");
    assert.equal(event.descriptor.flags, 0x30);
    assert.deepEqual(event.descriptor.scaleRate, [2, 1]);
    assert(start >= stop.window[0] && start + lifetime <= stop.window[1]);
    assert(!stop.events.some(({ target }) => target === handle));
    assert(!track.effects.some((existing) => existing.handle === handle));
    const id = `yasuo-wind-wall-flash-${handle}`;
    assert(!track.families.some((family) => family.id === id));
    return {
      effect: {
        handle,
        start,
        position: event.descriptor.positions[0],
        family: id,
      },
      family: {
        id,
        components: [
          {
            texture,
            palette,
            indices,
            lifetime,
            samples,
            blend: "src-alpha-one",
            alphaTest: true,
            depthTest: true,
            centerY: 0,
          },
        ],
      },
    };
  }),
);
assert.equal(
  new Set(entries.map(({ family }) => family.components[0].samples[4].vertices))
    .size,
  4,
);

const geometry = track.worldMaskedQuad;
const dependencies = new Set([
  ...track.textures.files,
  ...Object.values(track.shaders),
  geometry.vertexShader,
  geometry.fragmentShader,
  geometry.mask.path,
]);
const files = await Promise.all(
  [...dependencies].map(async (path) => {
    const digest =
      /^recorded-particles\/([a-f0-9]{64})\.(?:glsl|png|r8)$/u.exec(path)?.[1];
    assert(digest, `Unreviewed track dependency: ${path}`);
    return [path, await checked(join(base, path), digest)];
  }),
);
const manifest = JSON.stringify({
  ...track,
  effects: [...track.effects, ...entries.map(({ effect }) => effect)].sort(
    (a, b) => a.start - b.start || a.handle - b.handle,
  ),
  families: [...track.families, ...entries.map(({ family }) => family)],
  textures: { files: [...track.textures.files, texture] },
});
await mkdir(output);
await mkdir(join(output, "recorded-particles"));
await Promise.all(
  [...files, [texture, textureBytes]].map(([path, bytes]) =>
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
    events: entries.map(({ effect }) => effect),
  }),
);

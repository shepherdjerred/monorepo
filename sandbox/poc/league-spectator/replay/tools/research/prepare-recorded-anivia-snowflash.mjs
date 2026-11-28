import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const [
  base,
  fightPath,
  stopPath,
  lowPath,
  highPath,
  samplePath,
  pngPath,
  requested,
] = process.argv.slice(2);
assert.ok(
  process.argv.length === 10 && requested,
  "Usage: bun prepare-recorded-anivia-snowflash.mjs <reviewed V63 track root> <fight create receipt> <fight stop receipt> <0.125 control> <0.875 control> <seeded native probe> <SnowFlash mip-0 PNG> <fresh .cache output directory>",
);
const output = resolve(requested);
const parent = relative(
  await realpath(".cache"),
  await realpath(dirname(output)),
);
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u, 1)[0] !== "..");
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");

async function checked(path, digest) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), digest, `Unreviewed content: ${path}`);
  return bytes;
}
const readJson = async (path, digest) =>
  JSON.parse(await checked(path, digest));
const readNative = async (path, digest) => {
  const exact = (await readFile(path, "utf8")).replace(/\r?\n$/u, "");
  assert.equal(sha256(exact), digest, `Unreviewed native probe: ${path}`);
  return JSON.parse(exact);
};
const textureDigest =
  "c2c40c2bc7f6d15811504ccda9bcdcb3cc8ac1208674a41a3a086bd660e538a9";
const [track, fight, stop, low, high, sample, textureBytes] = await Promise.all(
  [
    readJson(
      join(base, "recorded-particles.json"),
      "daf9a07955bfadc36bf667557eb2b0c01ea6ed000059e135a8ebddba35e8a8e0",
    ),
    readJson(
      fightPath,
      "cbd5794411aaa4592763941c98a641cc33d14e73e2d291e52a632ad1989d3eb5",
    ),
    readJson(
      stopPath,
      "3f737589cb975f16b207fd47588c92d763b3b01079307576bc641c7e1ff5ebb3",
    ),
    readNative(
      lowPath,
      "fde883622051d1588455e6dc9e3640a68da988298a68546b2d9b38a534c31eb2",
    ),
    readNative(
      highPath,
      "6c4ede31b2a8896566c9efb9da3531c44588c5ae88dc385c10a8227a8793f956",
    ),
    readNative(
      samplePath,
      "9a59f4ea2be024913a3191a157be53d5cd973b37bd6a6e995f849acea9a54565",
    ),
    checked(pngPath, textureDigest),
  ],
);

assert.equal(track.schema, 4);
assert.equal(track.replaySha256, fight.replaySha256);
assert.equal(track.replaySha256, stop.replaySha256);
const family = "anivia-q-snowflash";
const texture = `recorded-particles/${textureDigest}.png`;
const palette =
  "recorded-particles/9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a.png";
const indices = "000001000200000002000300";
const lifetime = Math.fround(0.15);
const centerY = 30;
const handle = 1073820842;
const seedHex = Buffer.from(
  sha256(`${track.replaySha256}:${handle}`).slice(0, 16),
  "hex",
)
  .reverse()
  .toString("hex");
assert.equal(sample.seedHex, seedHex);
assert.deepEqual(low.rngSamples, [0.125, 0.125]);
assert.deepEqual(high.rngSamples, [0.875, 0.875]);
for (const control of [low, high, sample]) {
  assert.deepEqual(control.material, {
    pass: 4,
    descriptorHex:
      "3f0000000403000000000101010100010f000000000000000000000000000000",
    parameters: [
      ["ALPHA_TEST", 1],
      ["AlphaTestReferenceValue", [Math.fround(5 / 255), 0, 0, 0]],
    ],
    stages: ["ParticleSystem/QUAD_PS.ps", "ParticleSystem/QUAD_VS.vs"],
    defineCount: 0,
    requestFlagsHex: "00000000000000000000",
  });
  assert.equal(control.inserts.length, 1);
  assert.equal(control.inserts[0].lifetime, lifetime);
  assert.deepEqual(control.inserts[0].position, [0, centerY, 0]);
}

const degenerate = (hex) => {
  const view = Buffer.from(hex, "hex");
  return [28, 56, 84].every((offset) =>
    view.subarray(offset, offset + 12).equals(view.subarray(0, 12)),
  );
};
const samples = sample.timeline
  .filter(([age]) => age > 0)
  .map(([age, count, geometry]) => {
    assert.equal(count, 1);
    assert.equal(geometry.indexBytes, indices);
    const vertices = geometry.vertexBytes;
    assert.match(vertices, /^[a-f0-9]{224}$/u);
    assert.ok(!degenerate(vertices));
    const view = Buffer.from(vertices, "hex");
    for (let offset = 0; offset < view.length; offset += 28)
      assert.equal(view.readFloatLE(offset + 8), 0);
    return { age, vertices };
  });
assert.equal(samples.length, 7);
const midpoint = (control) =>
  Buffer.from(control.timeline[3][2].vertexBytes, "hex");
assert.notDeepEqual(
  midpoint(low).subarray(0, 12),
  midpoint(high).subarray(0, 12),
);
assert.notEqual(
  midpoint(low).readUInt16LE(26),
  midpoint(high).readUInt16LE(26),
);
const cohort = fight.events.filter(
  ({ resourceKey }) => resourceKey === 0xcd9f3617,
);
assert.equal(cohort.length, 1);
const [event] = cohort;
assert.equal(event.handle, handle);
assert.equal(event.owner, 1073742168);
assert.equal(event.context, 0);
assert.equal(event.parent, 0);
assert.equal(event.status, "detached-placement-confirmed");
assert.equal(event.descriptor.flags, 0x20);
assert.deepEqual(event.descriptor.scaleRate, [Math.fround(1.1), 1]);
const [position, second, third] = event.descriptor.positions;
assert.deepEqual(second, [0, 0, 0]);
assert.deepEqual(third, [0, 0, 0]);
assert.ok(
  event.stamp >= stop.window[0] && event.stamp + lifetime <= stop.window[1],
);
assert.ok(!stop.events.some(({ target }) => target === handle));
assert.ok(!track.families.some(({ id }) => id === family));
assert.ok(!track.effects.some((existing) => existing.handle === handle));
assert.ok(track.textures.files.includes(palette));
assert.ok(!track.textures.files.includes(texture));

const dependencies = new Set([
  ...track.textures.files,
  ...Object.values(track.shaders),
]);
const files = await Promise.all(
  [...dependencies].map(async (path) => {
    const digest = /^recorded-particles\/([a-f0-9]{64})\.(?:glsl|png)$/u.exec(
      path,
    )?.[1];
    assert.ok(digest, `Unreviewed track dependency: ${path}`);
    return [path, await checked(join(base, path), digest)];
  }),
);
const authored = {
  ...track,
  schema: 5,
  effects: [
    ...track.effects,
    { handle, start: event.stamp, position, family },
  ].sort((a, b) => a.start - b.start || a.handle - b.handle),
  families: [
    ...track.families.map(({ id, components }) => ({
      id,
      components: components.map((component) => ({
        ...component,
        depthTest: true,
      })),
    })),
    {
      id: family,
      components: [
        {
          texture,
          palette,
          blend: "one-one",
          centerY,
          alphaTest: true,
          depthTest: false,
          indices,
          lifetime,
          samples,
        },
      ],
    },
  ],
  textures: { files: [...track.textures.files, texture] },
};
const manifest = JSON.stringify(authored);
await mkdir(output);
await mkdir(join(output, "recorded-particles"));
await Promise.all([
  ...[...files, [texture, textureBytes]].map(([path, bytes]) =>
    writeFile(join(output, path), bytes, { flag: "wx" }),
  ),
  writeFile(join(output, "recorded-particles.json"), manifest, { flag: "wx" }),
]);
console.log(
  JSON.stringify({ output, sha256: sha256(manifest), handle, seedHex }),
);

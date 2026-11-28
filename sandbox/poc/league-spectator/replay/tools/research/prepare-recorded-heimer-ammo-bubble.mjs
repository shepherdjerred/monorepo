import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const [base, fightPath, stopPath, firstPath, secondPath, pngPath, requested] =
  process.argv.slice(2);
assert.ok(
  process.argv.length === 9 && requested,
  "Usage: bun prepare-recorded-heimer-ammo-bubble.mjs <reviewed v4 track directory> <fight create receipt> <fight stop receipt> <0.125 native probe> <0.875 native probe> <bubble mip0 PNG> <fresh .cache output directory>",
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

const nativeDigest =
  "a0a20c3167b18016c044079fac2089d47809955cc209ea185839689f44a85781";
const readNative = async (path) => {
  const exact = (await readFile(path, "utf8")).replace(/\r?\n$/u, "");
  assert.equal(sha256(exact), nativeDigest, `Unreviewed native probe: ${path}`);
  return JSON.parse(exact);
};
const textureDigest =
  "0df0fde80d211e8b9f53222a27b197fa79701a88e049a103554985cb1c1ac633";
const [track, fight, stop, native, randomControl, textureBytes] =
  await Promise.all([
    checked(
      join(base, "recorded-particles.json"),
      "626778bfdd0f92d3731f68d6514769a474dc50e30c240b5a868959fef38fb0f3",
    ).then((bytes) => JSON.parse(bytes)),
    checked(
      fightPath,
      "cbd5794411aaa4592763941c98a641cc33d14e73e2d291e52a632ad1989d3eb5",
    ).then((bytes) => JSON.parse(bytes)),
    checked(
      stopPath,
      "3f737589cb975f16b207fd47588c92d763b3b01079307576bc641c7e1ff5ebb3",
    ).then((bytes) => JSON.parse(bytes)),
    readNative(firstPath),
    readNative(secondPath),
    checked(pngPath, textureDigest),
  ]);

assert.equal(track.schema, 4);
assert.equal(track.replaySha256, fight.replaySha256);
assert.equal(track.replaySha256, stop.replaySha256);
assert.deepEqual(native, randomControl);
assert.deepEqual(native.material, {
  pass: 4,
  descriptorHex:
    "3f0000000503000000000101010100010f000000000000000000000000000000",
  parameters: [
    ["ALPHA_TEST", 1],
    ["AlphaTestReferenceValue", [Math.fround(5 / 255), 0, 0, 0]],
  ],
  stages: ["ParticleSystem/QUAD_PS.ps", "ParticleSystem/QUAD_VS.vs"],
  defineCount: 0,
  requestFlagsHex: "00000000000000000000",
});
const family = "heimerdinger-q-ammo-spend";
const indices = "000001000200000002000300";
const palette =
  "recorded-particles/c23e325cc59c7b6aa50a333e61fda6ae676022fd51a1a0eb54c75ccad3a9d84f.png";
const texture = `recorded-particles/${textureDigest}.png`;
const lifetime = native.inserts[0].lifetime;
assert.equal(lifetime, 0.5);
const samples = native.timeline
  .filter(([age]) => age > 0)
  .map(([age, count, geometry]) => {
    assert.equal(count, 1);
    assert.equal(geometry.indexBytes, indices);
    assert.match(geometry.vertexBytes, /^[a-f0-9]{224}$/u);
    const view = Buffer.from(geometry.vertexBytes, "hex");
    for (let offset = 0; offset < view.length; offset += 28)
      assert.equal(view.readFloatLE(offset + 8), 0);
    return { age, vertices: geometry.vertexBytes };
  });
assert.equal(samples.length, 7);
const cohort = fight.events.filter(
  ({ resourceKey }) => resourceKey === 0x45f7e988,
);
assert.deepEqual(
  cohort.map(({ handle }) => handle),
  [1073821059, 1073821231],
);
const events = cohort.map(
  ({ stamp, handle, owner, context, parent, status, descriptor }) => {
    assert.equal(owner, 1073742161);
    assert.equal(context, 0);
    assert.equal(parent, 0);
    assert.equal(status, "detached-placement-confirmed");
    assert.equal(descriptor.flags, 0x20);
    assert.deepEqual(descriptor.scaleRate, [1, 1]);
    const [position, fallback, unused] = descriptor.positions;
    assert.deepEqual(position, fallback);
    assert.deepEqual(unused, [0, 0, 0]);
    assert.ok(stamp >= stop.window[0] && stamp + lifetime <= stop.window[1]);
    assert.ok(!stop.events.some(({ target }) => target === handle));
    return { handle, start: stamp, position, family };
  },
);
assert.ok(!track.families.some(({ id }) => id === family));
assert.ok(
  !events.some(({ handle }) =>
    track.effects.some((event) => event.handle === handle),
  ),
);
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
  effects: [...track.effects, ...events].sort(
    (a, b) => a.start - b.start || a.handle - b.handle,
  ),
  families: [
    ...track.families,
    {
      id: family,
      components: [
        {
          texture,
          palette,
          blend: "one-one",
          centerY: 100,
          alphaTest: true,
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
  JSON.stringify({
    output,
    sha256: sha256(manifest),
    handles: events.map(({ handle }) => handle),
  }),
);

import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const sourceSha256 =
  "12eff6675a2a8b86ee51290c724fca394d42aadffddfd41c638017790c6958f3";
const materialSha256 =
  "fa2debf93d034e4223ade9b7ee538f59d0be1061fe4471463ed3ac5627c36a74";
const textureSha256 =
  "8162c9ec4ff74764bbce8f542a02c89a9f238bd1478dd66b2f196b28dc81c164";
const flash = {
  sourceSha256,
  materialSha256,
  textureSha256,
  placementCount: 2,
  birth: [0.5, Math.fround(0.15)],
  firstEmptyAge: 0.6500000357627869,
};
const maokaiSphere = {
  sourceSha256:
    "2c9bd39530461371932a7c5452cb0c29e46141991b9aa73666b33d7e520d3ee6",
  materialSha256:
    "ef3346c24c5a262c16b872b302a6d9503b8e34896a65208e6490f8ddaa86e385",
  textureSha256:
    "ed32f9d687e5b8932f4dd361d4bb8e0966ada34195d2c3cb7846f1867660b1ae",
  placementCount: 1,
  birth: [0, Math.fround(1.21)],
  firstEmptyAge: 1.2100001573562622,
};
const paletteSha256 =
  "9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a";
const vertexSha256 =
  "c9d94bb152fac1036a46871248ae3d310b6b47e178f4cb70cac44d55569dce97";
const fragmentSha256 =
  "11948a488fc18ecf633c1a672ba92c1bac38431ab7f295ac4f0ef5ca223cd3fc";
const hash = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const leaf = (sha256, extension) => `recorded-particles/${sha256}.${extension}`;

async function pinned(path, sha256) {
  const bytes = await readFile(path);
  assert.equal(
    hash(bytes),
    sha256,
    `Original comparison input differs: ${path}`,
  );
  return bytes;
}

const [inputPath, ...extra] = process.argv.slice(2);
assert.ok(
  inputPath && extra.length === 0,
  "Supply a private impact comparison input JSON file",
);
const inputs = JSON.parse(await readFile(inputPath));
const output = resolve(inputs.output);
const cache = await realpath(".cache");
const parent = relative(cache, await realpath(dirname(output)));
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u, 1)[0] !== "..");
async function prepareImpact(inputs, profile) {
  assert.match(inputs.geometry.sha256, /^[a-f0-9]{64}$/u);

  const [source, proof, materialBytes, texture] = await Promise.all([
    pinned(inputs.source, profile.sourceSha256).then(JSON.parse),
    pinned(inputs.geometry.path, inputs.geometry.sha256).then(JSON.parse),
    pinned(inputs.material, profile.materialSha256),
    pinned(inputs.texture, profile.textureSha256),
  ]);
  const material = materialBytes
    .toString("utf8")
    .trimEnd()
    .split(/\r?\n/u)
    .map(JSON.parse);
  for (const pass of [4, 6]) {
    const render = material.find((row) => row.pass === pass);
    assert.deepEqual(render.parameters, [
      ["ALPHA_TEST", 1],
      ["AlphaTestReferenceValue", [Math.fround(5 / 255), 0, 0, 0]],
    ]);
    assert.equal(
      render.descriptor,
      "3f0000001503000000000606010100011f000000000000000000000000000000",
    );
    const stages = material.find((row) => row.mode === pass);
    assert.equal(stages.vertex, "ParticleSystem/QUAD_VS.vs");
    assert.equal(stages.pixel, "ParticleSystem/QUAD_PS.ps");
  }
  assert.deepEqual(material.at(-1), {
    texture: source.emitter.texture,
    slot: 0,
    descriptorPrefix: "0000000101",
  });
  assert.equal(proof.kind, "recorded-mayhem-impact-native-geometry");
  assert.equal(proof.sourceReceiptSha256, profile.sourceSha256);
  assert.equal(proof.textureSha256, source.emitter.textureSha256);
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(proof[field], source[field]);
  assert.equal(proof.scope.suppliedRandomSamples, true);
  assert.equal(proof.scope.geometryObserved, true);
  assert.equal(proof.scope.browserDrawSubmitted, false);
  assert.equal(source.placements.length, profile.placementCount);
  assert.equal(proof.observations.length, profile.placementCount * 8);

  const paths = source.placements.map(({ handle }) => {
    const controls = proof.observations.filter((row) => row.handle === handle);
    assert.equal(controls.length, 8);
    for (const cadence of [60, 120]) {
      const sameCadence = controls.filter(
        (control) => control.cadence === cadence,
      );
      assert.equal(sameCadence.length, 4);
      assert.equal(
        new Set(
          sameCadence.map(({ cameraControl }) => JSON.stringify(cameraControl)),
        ).size,
        2,
      );
      assert.equal(
        new Set(
          sameCadence.map(({ suppliedRandomSample }) => suppliedRandomSample),
        ).size,
        2,
      );
      for (const other of sameCadence.slice(1))
        assert.deepEqual(other.geometry, sameCadence[0].geometry);
    }
    for (const observation of controls) {
      assert.deepEqual(observation.births, [profile.birth]);
      assert.equal(observation.firstEmptyFloat32Age, profile.firstEmptyAge);
      assert.equal(observation.geometry.at(-1)[0], observation.lastLiveAge);
    }
    const sample = controls.find(({ cadence }) => cadence === 120);
    return {
      handle,
      start: source.packet.time + sample.births[0][0],
      end: source.packet.time + sample.firstEmptyFloat32Age,
      samples: sample.geometry.map(([age, [indices, vertices]]) => ({
        age: age - sample.births[0][0],
        indices,
        vertices,
      })),
    };
  });
  return {
    source,
    texture,
    worldImpact: {
      texture: leaf(profile.textureSha256, "png"),
      palette: leaf(paletteSha256, "png"),
      paths,
    },
  };
}

const [primary, secondary, palette, vertex, fragment] = await Promise.all([
  prepareImpact(inputs, flash),
  inputs.maokaiSphere === undefined
    ? undefined
    : prepareImpact(inputs.maokaiSphere, maokaiSphere),
  pinned(inputs.palette, paletteSha256),
  pinned(inputs.vertex, vertexSha256),
  pinned(inputs.fragment, fragmentSha256),
]);
if (secondary !== undefined)
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(secondary.source[field], primary.source[field]);

const files = new Map([
  [primary.worldImpact.texture, primary.texture],
  [leaf(paletteSha256, "png"), palette],
  [leaf(vertexSha256, "glsl"), vertex],
  [leaf(fragmentSha256, "glsl"), fragment],
]);
if (secondary !== undefined)
  files.set(secondary.worldImpact.texture, secondary.texture);
const track = {
  schema: 8,
  kind: "recorded-native-terrain-particles",
  build: primary.source.build,
  replaySha256: primary.source.replaySha256,
  status: "controlled-mayhem-impact-comparison",
  scope: "native-sampled-supplied-random",
  shaders: {
    vertex: leaf(vertexSha256, "glsl"),
    fragment: leaf(fragmentSha256, "glsl"),
  },
  effects: [],
  families: [],
  worldImpact: primary.worldImpact,
  ...(secondary === undefined
    ? {}
    : { additionalWorldImpacts: [secondary.worldImpact] }),
  textures: {
    files: [...files.keys()].filter((path) => path.endsWith(".png")),
  },
};
await mkdir(output);
await mkdir(join(output, "recorded-particles"));
await Promise.all(
  [...files].map(([file, bytes]) =>
    writeFile(join(output, file), bytes, { flag: "wx" }),
  ),
);
const path = join(output, "recorded-particles.json");
const bytes = JSON.stringify(track);
await writeFile(path, bytes, { flag: "wx" });
console.log(JSON.stringify({ path, sha256: hash(bytes) }));

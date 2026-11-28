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
const repeatedFlash = {
  ...flash,
  placementCount: 28,
  repeated: true,
  geometrySha256:
    "921252fda613d6c74045592264ab8d77955ca9726dfe0b145c5c9d2473daf0d7",
};
const fullMatchFlash = {
  ...flash,
  repeated: true,
  fullMatch: true,
  placementCount: 2148,
  nativeProofContentSha256:
    "680fddf606faa268790a966f613df7afe0af47fc6583ee1f2ad1b378afcc1bec",
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
const heimerImpact = {
  family: "heimerdinger-w-impact",
  trackSha256:
    "9a781464e964e89f154c285133a45c4236aa1ed7dc8751979308fd923fae3827",
  stopSha256:
    "bb81d1e253d06442f10a2e8fe99337306df5a9fb74fb3950a42560623b810b6c",
};
const heimerAmmo = {
  family: "heimerdinger-q-ammo-spend",
  lifetime: 0.5,
  nativeSha256:
    "a0a20c3167b18016c044079fac2089d47809955cc209ea185839689f44a85781",
  stopsSha256:
    "8eb6f1c9bb85c000b5a8cc062c60c210610662ac6d3c7cc6a0e356cfb644c680",
  textureSha256:
    "0df0fde80d211e8b9f53222a27b197fa79701a88e049a103554985cb1c1ac633",
  paletteSha256:
    "c23e325cc59c7b6aa50a333e61fda6ae676022fd51a1a0eb54c75ccad3a9d84f",
};
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

async function prepareHeimerImpact(inputs, replaySha256, files) {
  const [track, stops] = await Promise.all([
    pinned(inputs.track, heimerImpact.trackSha256).then(JSON.parse),
    pinned(inputs.stops, heimerImpact.stopSha256).then(JSON.parse),
  ]);
  assert.equal(track.schema, 1);
  assert.equal(track.replaySha256, replaySha256);
  assert.equal(stops.replaySha256, replaySha256);
  assert.deepEqual(stops.matching, []);
  assert.deepEqual(
    stops.targetHandles,
    track.effects.map(({ handle }) => handle).sort((a, b) => a - b),
  );
  assert.ok(stops.first <= track.effects[0].start);
  assert.ok(stops.last >= track.effects.at(-1).start + Math.fround(0.3));
  assert.deepEqual(track.shaders, {
    vertex: leaf(vertexSha256, "glsl"),
    fragment: leaf(fragmentSha256, "glsl"),
  });
  for (const path of track.textures.files) {
    const digest = /^recorded-particles\/([a-f0-9]{64})\.png$/u.exec(path)?.[1];
    assert.ok(digest);
    files.set(path, await pinned(join(dirname(inputs.track), path), digest));
  }
  return {
    effects: track.effects.map((effect) => ({
      ...effect,
      family: heimerImpact.family,
    })),
    families: [
      {
        id: heimerImpact.family,
        components: track.components.map((component) => ({
          ...component,
          palette: track.textures.palette,
          blend: "one-one",
          centerY: 100,
          alphaTest: true,
          depthTest: true,
        })),
      },
    ],
  };
}

async function prepareHeimerAmmo(inputs, replaySha256, files) {
  const nativeBytes = (await readFile(inputs.native, "utf8")).replace(
    /\r?\n$/u,
    "",
  );
  assert.equal(hash(nativeBytes), heimerAmmo.nativeSha256);
  const native = JSON.parse(nativeBytes);
  assert.equal(native.inserts[0].lifetime, heimerAmmo.lifetime);
  const stops = JSON.parse(await pinned(inputs.stops, heimerAmmo.stopsSha256));
  assert.equal(stops.replaySha256, replaySha256);
  assert.deepEqual(stops.matching, []);
  assert.equal(stops.events.length, 84);
  assert.deepEqual(
    stops.targetHandles,
    stops.events.map(({ handle }) => handle).sort((a, b) => a - b),
  );
  const texture = leaf(heimerAmmo.textureSha256, "png");
  const palette = leaf(heimerAmmo.paletteSha256, "png");
  files.set(texture, await pinned(inputs.texture, heimerAmmo.textureSha256));
  if (!files.has(palette))
    files.set(palette, await pinned(inputs.palette, heimerAmmo.paletteSha256));

  const indices = "000001000200000002000300";
  const samples = native.timeline
    .filter(([age]) => age > 0)
    .map(([age, count, geometry]) => {
      assert.equal(count, 1);
      assert.equal(geometry.indexBytes, indices);
      return { age, vertices: geometry.vertexBytes };
    });
  const effects = stops.events.map(
    ({ stamp, handle, owner, context, parent, status, descriptor }) => {
      assert.equal(owner, 1073741898);
      assert.equal(context, 0);
      assert.equal(parent, 0);
      assert.equal(status, "detached-placement-confirmed");
      assert.equal(descriptor.resourceKey, 0x45f7e988);
      assert.equal(descriptor.flags, 0x20);
      assert.deepEqual(descriptor.scaleRate, [1, 1]);
      const [position, secondary, unused] = descriptor.positions;
      assert.deepEqual(position, secondary);
      assert.deepEqual(unused, [0, 0, 0]);
      assert.ok(
        stamp >= stops.first && stamp + heimerAmmo.lifetime <= stops.last,
      );
      return { handle, start: stamp, position, family: heimerAmmo.family };
    },
  );
  return {
    effects,
    families: [
      {
        id: heimerAmmo.family,
        components: [
          {
            texture,
            palette,
            blend: "one-one",
            centerY: native.inserts[0].position[1],
            alphaTest: true,
            depthTest: true,
            indices,
            lifetime: heimerAmmo.lifetime,
            samples,
          },
        ],
      },
    ],
  };
}

const [inputPath, ...extra] = process.argv.slice(2);
assert.ok(
  inputPath && extra.length === 0,
  "Supply a private impact comparison input JSON file",
);
const inputs = JSON.parse(await readFile(inputPath));
assert.ok(
  inputs.repeatOpeningFlash === undefined || inputs.repeatOpeningFlash === true,
);
assert.ok(
  inputs.fullMatchFlash === undefined || inputs.fullMatchFlash === true,
);
assert.ok(!(inputs.repeatOpeningFlash && inputs.fullMatchFlash));
const output = resolve(inputs.output);
const cache = await realpath(".cache");
const parent = relative(cache, await realpath(dirname(output)));
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u, 1)[0] !== "..");
async function prepareImpact(inputs, profile) {
  assert.match(inputs.geometry.sha256, /^[a-f0-9]{64}$/u);
  if (profile.geometrySha256 !== undefined)
    assert.equal(inputs.geometry.sha256, profile.geometrySha256);

  const [source, proofBytes, materialBytes, texture] = await Promise.all([
    pinned(inputs.source, profile.sourceSha256).then(JSON.parse),
    pinned(inputs.geometry.path, inputs.geometry.sha256),
    pinned(inputs.material, profile.materialSha256),
    pinned(inputs.texture, profile.textureSha256),
  ]);
  if (profile.fullMatch)
    assert.equal(
      hash(proofBytes.toString("utf8").replace(/\r?\n$/u, "")),
      profile.nativeProofContentSha256,
      "Unreviewed full-match Flash native geometry",
    );
  const proof = JSON.parse(proofBytes);
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
  assert.equal(proof.fullMatchFlash === true, profile.fullMatch === true);
  assert.equal(
    proof.repeatedPlacements !== undefined,
    profile.repeated === true,
  );
  const placements = profile.repeated
    ? proof.repeatedPlacements
    : source.placements;
  assert.equal(placements.length, profile.placementCount);
  assert.equal(
    new Set(placements.map(({ handle }) => handle)).size,
    placements.length,
  );
  if (profile.repeated) {
    if (!profile.fullMatch)
      assert.equal(
        new Set(placements.map(({ sequence }) => sequence)).size,
        14,
      );
    for (const prior of source.placements) {
      assert.deepEqual(
        placements.find(({ handle }) => handle === prior.handle),
        {
          ...prior,
          timeSeconds: source.packet.time,
          sequence: source.packet.sequence,
          packetSha256: source.packet.payloadSha256,
        },
      );
    }
  }
  assert.equal(
    proof.observations.length,
    profile.fullMatch
      ? profile.placementCount + 42
      : profile.placementCount * 8,
  );
  const byHandle = new Map(placements.map(({ handle }) => [handle, []]));
  for (const observation of proof.observations) {
    const controls = byHandle.get(observation.handle);
    assert.ok(
      controls,
      "Native geometry observation has no recorded placement",
    );
    controls.push(observation);
  }

  const paths = placements.map(({ handle, timeSeconds }, index) => {
    const time = profile.repeated ? timeSeconds : source.packet.time;
    assert.ok(Number.isFinite(time) && time >= 0);
    const controls = byHandle.get(handle);
    const hasAdditionalControls =
      !profile.fullMatch || [0, 250, 674, 1100, 1900, 2147].includes(index);
    assert.equal(controls.length, hasAdditionalControls ? 8 : 1);
    for (const cadence of hasAdditionalControls ? [60, 120] : [120]) {
      const sameCadence = controls.filter(
        (control) => control.cadence === cadence,
      );
      assert.equal(sameCadence.length, hasAdditionalControls ? 4 : 1);
      if (profile.fullMatch) {
        const expectedControls = hasAdditionalControls
          ? [
              [0.125, [5900, 1500, 6200]],
              [0.125, [6150, 1700, 5950]],
              [0.875, [5900, 1500, 6200]],
              [0.875, [6150, 1700, 5950]],
            ]
          : [[0.125, [5900, 1500, 6200]]];
        assert.deepEqual(
          sameCadence.map(({ suppliedRandomSample, cameraControl }) => [
            suppliedRandomSample,
            cameraControl,
          ]),
          expectedControls,
        );
      }
      if (!hasAdditionalControls) continue;
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
    if (profile.fullMatch) {
      assert.deepEqual(
        sample.geometry.map(([age]) => age),
        [
          ...Array.from({ length: 19 }, (_, index) => (60 + index) / 120),
          0.5 + Math.fround(0.15),
        ],
      );
    }
    return {
      handle,
      start: time + sample.births[0][0],
      end: time + sample.firstEmptyFloat32Age,
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

function packWorldImpact({ texture, palette, paths }, files) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(paths.length);
  const chunks = [header];
  let previousStart = -Infinity;
  for (const { handle, start, end, samples } of paths) {
    assert.ok(
      start >= previousStart,
      "Packed Flash placements must follow the replay clock",
    );
    previousStart = start;
    const path = Buffer.alloc(24);
    path.writeUInt32LE(handle, 0);
    path.writeDoubleLE(start, 4);
    path.writeDoubleLE(end, 12);
    path.writeUInt32LE(samples.length, 20);
    chunks.push(path);
    for (const { age, indices, vertices } of samples) {
      assert.equal(indices, "000001000200000002000300");
      assert.match(vertices, /^[a-f0-9]{224}$/u);
      const vertexBytes = Buffer.from(vertices, "hex");
      const indexBytes = Buffer.from(indices, "hex");
      const sample = Buffer.alloc(12);
      sample.writeDoubleLE(age, 0);
      sample.writeUInt16LE(vertexBytes.length, 8);
      sample.writeUInt16LE(indexBytes.length, 10);
      chunks.push(sample, vertexBytes, indexBytes);
    }
  }
  const geometry = Buffer.concat(chunks);
  assert.ok(geometry.length <= 16 * 1024 * 1024);
  const path = leaf(hash(geometry), "bin");
  files.set(path, geometry);
  return { texture, palette, path, bytes: geometry.length };
}

const [primary, secondary, palette, vertex, fragment] = await Promise.all([
  prepareImpact(
    inputs,
    inputs.fullMatchFlash
      ? fullMatchFlash
      : inputs.repeatOpeningFlash
        ? repeatedFlash
        : flash,
  ),
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
const originalFlashHandles = new Set(
  primary.source.placements.map(({ handle }) => handle),
);
const worldImpact = {
  ...primary.worldImpact,
  paths: primary.worldImpact.paths.filter(({ handle }) =>
    originalFlashHandles.has(handle),
  ),
};
const additionalWorldImpacts = [];
if (inputs.repeatOpeningFlash)
  additionalWorldImpacts.push({
    ...primary.worldImpact,
    paths: primary.worldImpact.paths.filter(
      ({ handle }) => !originalFlashHandles.has(handle),
    ),
  });
if (secondary !== undefined) additionalWorldImpacts.push(secondary.worldImpact);
const heimer =
  inputs.heimerImpact === undefined
    ? { effects: [], families: [] }
    : await prepareHeimerImpact(
        inputs.heimerImpact,
        primary.source.replaySha256,
        files,
      );
const ammo =
  inputs.heimerAmmo === undefined
    ? { effects: [], families: [] }
    : await prepareHeimerAmmo(
        inputs.heimerAmmo,
        primary.source.replaySha256,
        files,
      );
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
  effects: [...heimer.effects, ...ammo.effects].sort(
    (a, b) => a.start - b.start || a.handle - b.handle,
  ),
  families: [...heimer.families, ...ammo.families],
  ...(inputs.fullMatchFlash
    ? { packedWorldImpacts: [packWorldImpact(primary.worldImpact, files)] }
    : { worldImpact }),
  ...(additionalWorldImpacts.length === 0 ? {} : { additionalWorldImpacts }),
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

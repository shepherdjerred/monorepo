import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep, toNamespacedPath } from "node:path";
import { readLocalRecordedParticles } from "../build-local-scout-terrain-package.mjs";

// Generate ribbon-final-<slot>-<random>.json with the companion native probe,
// for slots 0, 1, and 2 and random values 0.125 and 0.875. Both runs must retain
// the same indexed world geometry. The author preserves the v3 effects and
// keeps only ribbon samples strictly before each recorded contact or stop.
const usage =
  "bun prepare-recorded-maokai-ribbon.mjs <v3-track-root> <motion-receipt> <native-receipt-directory> <base-mip0-png> <default-color-png> <new-private-output-root>\n" +
  "bun prepare-recorded-maokai-ribbon.mjs --outer <existing-ribbon-track-root> <base-sha256> <outer-motion-receipt> <native-receipt-directory> <new-private-output-root>";
const args = process.argv.slice(2);
const outer = args[0] === "--outer";
if (outer) args.shift();
const [
  trackRoot,
  motionPath,
  receiptRoot,
  texturePath,
  palettePath,
  outputRoot,
] = outer ? [args[0], args[2], args[3], null, null, args[4]] : args;
if (trackRoot === "--help") {
  console.log(usage);
  process.exit(0);
}
assert.equal(args.length, outer ? 5 : 6, usage);
const cache = await realpath(".cache");
const output = resolve(outputRoot);
const parent = await realpath(dirname(output));
assert(
  parent === cache || parent.startsWith(cache + sep),
  "Expected a fresh output directory inside .cache",
);

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const read = (path) => readFile(toNamespacedPath(resolve(path)));
async function checked(path, expected) {
  const bytes = await read(path);
  assert.equal(sha(bytes), expected, `Reviewed content differs: ${path}`);
  return bytes;
}

const replaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const vertex =
  "c9d94bb152fac1036a46871248ae3d310b6b47e178f4cb70cac44d55569dce97";
const fragment =
  "11948a488fc18ecf633c1a672ba92c1bac38431ab7f295ac4f0ef5ca223cd3fc";
const manifestPath = resolve(trackRoot, "recorded-particles.json");
const baseFiles = outer
  ? await readLocalRecordedParticles(manifestPath, args[1], {
      build: "16.23.841.8428",
      replaySha256,
    })
  : null;
const source = JSON.parse(
  baseFiles
    ? baseFiles.get("recorded-particles.json")
    : await read(manifestPath),
);
assert(outer ? [4, 5, 6].includes(source.schema) : source.schema === 3);
assert.equal(source.kind, "recorded-native-terrain-particles");
assert.equal(source.build, "16.23.841.8428");
assert.equal(source.replaySha256, replaySha256);
assert.equal(source.shaders.vertex, `recorded-particles/${vertex}.glsl`);
assert.equal(source.shaders.fragment, `recorded-particles/${fragment}.glsl`);

const motion = JSON.parse(
  await checked(
    motionPath,
    outer
      ? "11dfea28db28ca841a38e21d0cd53620bfaab98895ea99288bc340b0c9c7f5cf"
      : "2c97bd8d259a544f2e145e47bbedd676b6b0e912991f2a1eaa283c337ae1b94a",
  ),
);
assert.equal(motion.replaySha256, replaySha256);
const nativeTraces = outer
  ? [
      [
        1073820800,
        "5b52dcac3e89463b34c014b834676f1f4965977a5d6f3781780f68bbf72e1416",
        "d20fcb7d79587b16e1e136eea1f5a9b09b63c9a15535fa4becec306a867cde7f",
      ],
      [
        1073820809,
        "62c7b16a994a4afa6861e8b28c2b214c4bcd08001eee4e2dc0f3563d2ddbea64",
        "a16c3fe1712eccc4987e78d2f82fffd3b68372094a7d68c287e7188b754a1a4f",
      ],
    ]
  : [
      [
        1073820771,
        "7c280e46b3be229decff2db237c746c4b268e3f214f365a00d338a145ae6b127",
        "6f42938ccb72f26e437362945ffe397912d45317e0c248acb950831bb7a9707a",
      ],
      [
        1073820782,
        "e29100bbf32bff325576e661eaa2b80363d85fac7eebb77668136bc5fba08dc1",
        "e5e61249f876aee30af4ddd296009a311ee42a279199b90419291e7186b9e26d",
      ],
      [
        1073820791,
        "48c977fa7b78ba8538a47b117a685deed9cbdac8899ef41361b76f0092190d41",
        "c5df27a2b2489cbe1d13f3d84cc22e4aa82e33a1f2507fae03d478a127fc5e0b",
      ],
    ];
const paths = await Promise.all(
  nativeTraces.map(async ([handle, digest, controlDigest], index) => {
    const receiptStem = outer ? "ribbon-outer" : "ribbon-final";
    const [trace, control] = await Promise.all([
      checked(
        resolve(receiptRoot, `${receiptStem}-${index}-0.125.json`),
        digest,
      ).then((bytes) => JSON.parse(bytes)),
      checked(
        resolve(receiptRoot, `${receiptStem}-${index}-0.875.json`),
        controlDigest,
      ).then((bytes) => JSON.parse(bytes)),
    ]);
    const trajectory = motion.cases[index];
    const {
      recordedLaunchTimeSeconds: start,
      motionVerifiedThroughSeconds: end,
    } = trajectory;
    assert.equal(trajectory.entity, handle);
    assert.equal(trace.entity, handle);
    assert.equal(trace.spawn.key, 0x3d2e0fe6);
    assert.equal(trace.spawn.sourceContext, 1073742170);
    assert.deepEqual(
      trace.spawn.positionXYZ,
      trajectory.samples[0].positionXYZ,
    );
    assert.deepEqual(trace.timeline, control.timeline);
    assert.equal(trace.timeline.length, trajectory.samples.length);
    if (outer) {
      assert.equal(trajectory.recordedStopTimeSeconds, null);
      assert.equal(trajectory.firstUnclassifiedPacket.seconds, end);
    }
    assert.equal(trace.materialState.pass, 5);
    assert.equal(
      trace.materialState.descriptorHex,
      "3f0000000d03000000000606010100010f00000000000000000080bf000000c0",
    );

    const samples = [];
    let previous = 0;
    for (const [frame, [age, count, geometry]] of trace.timeline.entries()) {
      const { timeSeconds, positionXYZ } = trajectory.samples[frame];
      assert.equal(age, timeSeconds - start);
      if (geometry === null || age >= end - start) continue;
      assert(age > previous);
      previous = age;
      for (const bytes of [geometry.vertexBytes, geometry.indexBytes]) {
        assert.match(bytes, /^(?:[\da-f]{2})+$/);
      }
      const indices = Buffer.from(geometry.indexBytes, "hex");
      const vertices = Buffer.from(geometry.vertexBytes, "hex");
      assert.equal(vertices.length, count * 56);
      assert.equal(indices.length, (count - 1) * 12);
      for (let offset = 0; offset < indices.length; offset += 2) {
        assert(indices.readUInt16LE(offset) < count * 2);
      }
      for (let offset = 0; offset < vertices.length; offset += 28) {
        assert(
          Math.hypot(
            ...positionXYZ.map(
              (value, axis) => vertices.readFloatLE(offset + axis * 4) - value,
            ),
          ) < 500,
        );
      }
      samples.push({
        age,
        vertices: geometry.vertexBytes,
        indices: geometry.indexBytes,
      });
    }
    assert(samples.length > 60);
    return { handle, start, end, samples };
  }),
);

const texture =
  "5d12032cdab3f822722f45ac312843f78b3723572181bc760d76d231cee027ce";
const palette =
  "9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a";
const ribbonTexture = `recorded-particles/${texture}.png`;
const ribbonPalette = `recorded-particles/${palette}.png`;
const files =
  baseFiles ??
  new Map(
    await Promise.all(
      [
        ...new Set([
          ...source.textures.files,
          ...Object.values(source.shaders),
        ]),
      ].map(async (path) => {
        const valid = /^recorded-particles\/([\da-f]{64})\.(?:glsl|png)$/.exec(
          path,
        );
        assert(valid, "Unrecognized v3 asset path");
        return [path, await checked(resolve(trackRoot, path), valid[1])];
      }),
    ),
  );
files.delete("recorded-particles.json");
let track;
if (outer) {
  assert.equal(source.worldRibbon.texture, ribbonTexture);
  assert.equal(source.worldRibbon.palette, ribbonPalette);
  const retainedPaths = source.worldRibbon.paths;
  assert(
    [1073820771, 1073820782, 1073820791].every((handle) =>
      retainedPaths.some((path) => path.handle === handle),
    ),
  );
  assert(
    paths.every(({ handle }) =>
      retainedPaths.every((path) => path.handle !== handle),
    ),
  );
  track = {
    ...source,
    worldRibbon: { ...source.worldRibbon, paths: [...retainedPaths, ...paths] },
  };
} else {
  files.set(ribbonTexture, await checked(texturePath, texture));
  files.set(ribbonPalette, await checked(palettePath, palette));
  track = {
    ...source,
    schema: 4,
    textures: {
      ...source.textures,
      files: [
        ...new Set([...source.textures.files, ribbonTexture, ribbonPalette]),
      ],
    },
    worldRibbon: { texture: ribbonTexture, palette: ribbonPalette, paths },
  };
}

await mkdir(output);
await mkdir(resolve(output, "recorded-particles"));
for (const [path, bytes] of files) {
  await writeFile(toNamespacedPath(resolve(output, path)), bytes, {
    flag: "wx",
  });
}
const encoded = JSON.stringify(track);
await writeFile(
  toNamespacedPath(resolve(output, "recorded-particles.json")),
  encoded,
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    output,
    sha256: sha(encoded),
    paths: paths.map(({ handle, start, end, samples }) => [
      handle,
      start,
      end,
      samples.length,
    ]),
  }),
);

import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  readOrdinalAccessor,
  readOrdinalChampionGlb,
} from "./research/native-terrain-actors.mjs";

const [packageRoot, batch, threeCore, output] = process.argv.slice(2);
assert.ok(
  packageRoot &&
    batch &&
    threeCore &&
    (process.argv.length === 5 ||
      (process.argv.length === 6 && output === "--emit-impact-trs")),
  "Usage: bun verify-recorded-joint-frames.mjs <.8428 private terrain package> <matching recorded animation batch> <three.core.js> [--emit-impact-trs]",
);
const hash = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const file = (path) =>
  Bun.file(process.platform === "win32" ? "\\\\?\\" + resolve(path) : path);
const app = fileURLToPath(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app",
    import.meta.url,
  ),
);
const bundle = await Bun.build({
  entrypoints: [
    fileURLToPath(new URL("../scout-terrain-animations.ts", import.meta.url)),
  ],
  format: "esm",
  target: "browser",
  plugins: [
    {
      name: "recorded-joint-proof",
      setup(builder) {
        builder.onResolve({ filter: /^\/three\.core\.js$/u }, () => ({
          path: resolve(threeCore),
        }));
        builder.onResolve({ filter: /^zod$/u }, () => ({
          path: Bun.resolveSync("zod", app),
        }));
      },
    },
  ],
});
assert.ok(bundle.success && bundle.outputs.length === 1);
const directory = await mkdtemp(join(tmpdir(), "scout-joint-proof-"));
const artifact = join(directory, "animations.mjs");
const { loadRecordedChampionAnimations } = await (async () => {
  await Bun.write(artifact, bundle.outputs[0]);
  try {
    return await import(pathToFileURL(artifact).href);
  } finally {
    await unlink(artifact);
    await rmdir(directory);
  }
})();
const { Matrix4, Quaternion, Vector3 } = await import(
  pathToFileURL(resolve(threeCore)).href
);

const { build, protocol, replaySha256, cues } = await file(
  resolve(batch, "scout-animation.json"),
).json();
assert.equal(build, "16.23.841.8428");
assert.equal(protocol, "8bbfcd5af2bc92db");
const { identity } = await file(resolve(packageRoot, "scene.json")).json();
assert.equal(identity.replaySha256, replaySha256);
assert.equal(identity.build, build);
assert.equal(identity.protocol, protocol);
const match = (champion, action, timeSeconds) => {
  const cue = cues.find(
    (cue) =>
      cue.champion === champion &&
      cue.request.name === action &&
      cue.timeSeconds === timeSeconds,
  );
  assert.ok(cue, `Missing recorded ${champion} ${action}`);
  return cue;
};
const monkeyKing = match("MonkeyKing", "Spell1", 1716.2024140625);
const kaisa = match("Kaisa", "Helmet_On", 1718.8984140625);
const paths = new Map();
function cueResources(cue) {
  const model = `/champion-models/${cue.modelSha256}.glb`;
  paths.set(model, resolve(packageRoot, "." + model));
  const resources = {};
  for (const [key, extension] of [
    ["rig", "skl"],
    ["clip", "clip"],
    ["bindings", "json"],
  ]) {
    const asset = cue[key];
    resources[key] = `/champion-animations/${asset.sha256}.${extension}`;
    paths.set(resources[key], resolve(batch, asset.file));
  }
  const { participantId, timeSeconds, endSeconds, rate } = cue;
  return { participantId, timeSeconds, endSeconds, rate, model, ...resources };
}
const read = async (route) => {
  const path = paths.get(route);
  assert.ok(path, `Unknown animation asset ${route}`);
  const bytes = await file(path).arrayBuffer();
  assert.equal(hash(bytes), route.match(/\/([a-f0-9]{64})\./u)[1]);
  return bytes;
};
const monkeyKingCue = cueResources(monkeyKing);
const kaisaCue = cueResources(kaisa);
const palettesAt = await loadRecordedChampionAnimations(
  [monkeyKingCue, kaisaCue],
  2000,
  read,
);
const frame = new Matrix4();
const { gltf, binary } = readOrdinalChampionGlb(
  await read(monkeyKingCue.model),
);
const bindings = JSON.parse(
  new TextDecoder().decode(await read(monkeyKingCue.bindings)),
);
const hand = bindings.joints.find(
  ({ originalName }) => originalName === "l_hand",
);
const handSlot = bindings.palette.find(
  ({ poseJointIndex }) => poseJointIndex === hand.poseJointIndex,
).paletteIndex;
const inverseBind = readOrdinalAccessor(
  gltf,
  binary,
  gltf.skins[0].inverseBindMatrices,
  "MAT4",
  { 5126: 4 },
  16,
);
const inverse = new DataView(
  inverseBind.data.buffer,
  inverseBind.data.byteOffset,
  inverseBind.data.byteLength,
);
const bindMatrix = new Matrix4()
  .fromArray(
    Array.from({ length: 16 }, (_, lane) =>
      inverse.getFloat32(
        inverseBind.offset + inverseBind.stride * handSlot + 4 * lane,
        true,
      ),
    ),
  )
  .invert();

// Exact palette digests from the pre-change sampler on these recorded cues.
const baseline = [
  "4c463819f532965219c8c0f64c8e7c0217ee80c67dcb5d0786827b5b4f4dbe92",
  "6b24a4fe8faed8b70c4f4c73c50bc619fb696cccfbce14e9b40c047eebf60a95",
  "efd3617d216737683ee7aaffbe8c12bc06cd2c3a5070462df203cc1ed2b03ad0",
];
const handFrames = [];
for (const sample of [0, 1, 2, 0]) {
  const time = monkeyKing.timeSeconds + sample / 8;
  assert.equal(
    palettesAt.copyJointModelFrameAt(
      time,
      monkeyKing.participantId,
      "l_hand",
      frame,
    ),
    true,
  );
  const palette = palettesAt(time, [monkeyKing]).get(monkeyKing.participantId);
  assert.equal(hash(palette), baseline[sample]);
  const jointFromPalette = new Matrix4()
    .fromArray(palette, 16 * handSlot)
    .multiply(bindMatrix);
  for (const [index, entry] of frame.elements.entries())
    assert.ok(Math.abs(entry - jointFromPalette.elements[index]) < 1e-4);
  handFrames.push(frame.clone());
}
assert.notDeepEqual(handFrames[0], handFrames[1]);
assert.notDeepEqual(handFrames[1], handFrames[2]);
assert.deepEqual(handFrames[0], handFrames[3]);
for (const time of [monkeyKing.timeSeconds - 0.001, monkeyKing.endSeconds]) {
  assert.equal(
    palettesAt.copyJointModelFrameAt(
      time,
      monkeyKing.participantId,
      "l_hand",
      frame,
    ),
    false,
  );
  assert.deepEqual(frame, handFrames[0]);
  assert.equal(palettesAt(time, [monkeyKing]).size, 0);
}

const clock = kaisa.timeSeconds + 0.125;
const kaisaPalette = palettesAt(clock, [kaisa]).get(kaisa.participantId);
assert.equal(
  hash(kaisaPalette),
  "e1458c7da503062eece7f6ba0b79121c42406c34b2e46eadce81b267871c8810",
);
const kaisaBindings = JSON.parse(
  new TextDecoder().decode(await read(kaisaCue.bindings)),
);
const socketFrames = [];
for (const [name, nameHash, ordinal] of [
  ["L_Buffbone_Missile1", 0x0bb4e811, 86],
  ["R_Buffbone_Missile1", 0x01b4e811, 89],
]) {
  assert.ok(
    kaisaBindings.palette.every((row) => row.poseJointIndex !== ordinal),
  );
  const selected = new Matrix4();
  assert.equal(
    palettesAt.copyJointModelFrameAt(
      clock,
      kaisa.participantId,
      { nameHash },
      selected,
    ),
    true,
  );
  assert.ok(selected.elements.every(Number.isFinite));
  for (const joint of [name, ordinal]) {
    assert.equal(
      palettesAt.copyJointModelFrameAt(
        clock,
        kaisa.participantId,
        joint,
        frame,
      ),
      true,
    );
    assert.deepEqual(frame, selected);
  }
  socketFrames.push(selected);
}
assert.notDeepEqual(socketFrames[0], socketFrames[1]);
for (const joint of [
  { nameHash: 0 },
  { nameHash: 0x0ac10083 },
  "scout_joint_86",
]) {
  assert.equal(
    palettesAt.copyJointModelFrameAt(clock, kaisa.participantId, joint, frame),
    false,
  );
  assert.deepEqual(frame, socketFrames[1]);
}
const impactTime = 1719.2644140625;
assert.ok(impactTime >= kaisa.timeSeconds && impactTime < kaisa.endSeconds);
const impactFrame = new Matrix4();
assert.equal(
  palettesAt.copyJointModelFrameAt(
    impactTime,
    kaisa.participantId,
    { nameHash: 0x0ac0f283 },
    impactFrame,
  ),
  true,
);
for (const joint of ["C_Buffbone_Glb_Center_Loc", 60]) {
  assert.equal(
    palettesAt.copyJointModelFrameAt(
      impactTime,
      kaisa.participantId,
      joint,
      frame,
    ),
    true,
  );
  assert.deepEqual(frame, impactFrame);
}
assert.ok(impactFrame.elements.every(Number.isFinite));
if (output === "--emit-impact-trs") {
  const position = new Vector3();
  const scale = new Vector3();
  const orientation = new Quaternion();
  impactFrame.decompose(position, orientation, scale);
  const recomposed = new Matrix4().compose(position, orientation, scale);
  assert.ok(
    impactFrame.elements.every(
      (value, index) => Math.abs(value - recomposed.elements[index]) < 1e-9,
    ),
  );
  console.log(
    JSON.stringify({
      replaySha256,
      build,
      protocol,
      time: impactTime,
      modelSha256: kaisa.modelSha256,
      clipSha256: kaisa.clip.sha256,
      rigSha256: kaisa.rig.sha256,
      bindingsSha256: kaisa.bindings.sha256,
      key: 0x0ac0f283,
      trs: [
        ...position.toArray(),
        ...scale.toArray(),
        ...orientation.toArray(),
      ],
    }),
  );
} else {
  console.log(
    "Recorded joint frames verified across palette composition, rewind, cutoff, both authored missile sockets and the impact target socket.",
  );
}

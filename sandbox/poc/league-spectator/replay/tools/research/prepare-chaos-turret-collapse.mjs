import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash as hash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";
import { chaosTurretCollapsePaths } from "./native-terrain-turret-collapse-assets.mjs";
import { currentMap11WadIndexSha256 } from "./native-terrain-turrets.mjs";

const [
  installation,
  catalogDirectory,
  executable,
  requestedOutput,
  python,
  ...pythonArgs
] = process.argv.slice(2);
assert.ok(
  python,
  "Usage: bun prepare-chaos-turret-collapse.mjs <League installation> <authored turret catalog directory> <archived executable> <new direct .cache child> <Python command> [Python arguments ...]",
);
const out = resolve(requestedOutput);
assert.equal(dirname(out), await realpath(".cache"));
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const routeDigest = (route) => route.split("/").at(-1).split(".")[0];

const wad = await openLocalWad(
  installation,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  Bun.zstdDecompressSync,
  currentMap11WadIndexSha256,
);
const skinPath = "data/characters/turret/skins/skin3.bin";
const graphPath = "DATA/Characters/Turret/Animations/Skin2.bin";
const field = (node, key) => node?.fields?.[hash(key)];
const skinBin = readExactMapBin(await wad(skinPath));
const skin = skinBin.objects.find(
  ({ pathHash }) => pathHash === hash("Characters/Turret/Skins/Skin3"),
);
assert.equal(skin?.classHash, hash("SkinCharacterDataProperties"));
const graphRef = field(
  field(skin, "skinAnimationProperties"),
  "animationGraphData",
);
assert.equal(graphRef?.type, "ObjectLink");
assert.ok(skinBin.dependencies.includes(graphPath));
const graphBytes = await wad(graphPath);
assert.equal(
  sha256(graphBytes),
  "8e690e1ce119d17e33b82b17159a256d7810bac57b0b6a9e272e9b2bb65c4c64",
);
const graph = readExactMapBin(graphBytes).objects.find(
  ({ pathHash }) => Number.parseInt(pathHash, 16) === graphRef.value,
);
assert.equal(graph?.classHash, hash("AnimationGraphData"));
const clips = field(graph, "mClipDataMap").entries;
const clipById = (id) => {
  const matches = clips.filter(
    ({ key }) => key.type === "Hash" && key.value === id,
  );
  assert.equal(matches.length, 1);
  return matches[0].value;
};
const death = clipById(Number.parseInt(hash("Death"), 16));
assert.equal(death.classHash, "2160b3ec");
const sequence = death.fields["078cafd9"].elements;
assert.equal(sequence.length, 1);
assert.equal(sequence[0].type, "Hash");
const clip = clipById(sequence[0].value);
assert.equal(clip.classHash, hash("AtomicClipData"));
const toHashedList = (names) =>
  names.map((name) => Number.parseInt(hash(name), 16));
const visibility = clip.fields.f598463e.entries
  .filter(({ value }) => value.classHash === hash("SubmeshVisibilityEventData"))
  .map(({ value }) => [
    field(value, "mStartFrame")?.value ?? 0,
    field(value, "mShowSubmeshList")?.elements.map((row) => row.value) ?? [],
    field(value, "mHideSubmeshList")?.elements.map((row) => row.value) ?? [],
  ]);
assert.deepEqual(visibility, [
  [
    0,
    toHashedList(["Stage2", "Stage3"]),
    toHashedList([
      "Base",
      "Stage1",
      "Cloth1",
      "Cloth2",
      "Broken1",
      "Broken2",
      "Broken3",
    ]),
  ],
  [16, [], toHashedList(["Stage2"])],
  [57, toHashedList(["RubbleBase", "Rubble"]), []],
]);
const animationRef = field(
  field(clip, "mAnimationResourceData"),
  "mAnimationFilePath",
);
assert.equal(animationRef?.type, "WadChunkLink");
const animation = await wad.byHash(BigInt(animationRef.value));
const animationDigest = sha256(animation);
assert.equal(
  animationDigest,
  "bf7dde93dad510d21caa36e0f80ed00b3cf5c265d0c3a80a3f2f5fbcdc961774",
);

const [rig, bindings] = await Promise.all([
  readFile(join(catalogDirectory, "work", "turret-3", "model.skl")),
  readFile(join(catalogDirectory, "turret-3", "joint-bindings.json")),
]);
assert.equal(sha256(rig), routeDigest(chaosTurretCollapsePaths.rig));
assert.equal(sha256(bindings), routeDigest(chaosTurretCollapsePaths.bindings));
await mkdir(out);
assert.ok((await realpath(out)).startsWith((await realpath(".cache")) + sep));
const rigPath = join(out, "model.skl");
const animationPath = join(out, "collapse.anm");
const clipPath = join(out, "collapse.clip");
const receiptPath = join(out, "archive-evaluation.json");
await Promise.all([
  writeFile(rigPath, rig, { flag: "wx" }),
  writeFile(join(out, "joint-bindings.json"), bindings, { flag: "wx" }),
  writeFile(animationPath, animation, { flag: "wx" }),
]);
const probe = fileURLToPath(
  new URL("../probe-exact-compressed-animation.py", import.meta.url),
);
const result = Bun.spawnSync([
  python,
  ...pythonArgs,
  probe,
  "--current-build",
  "--client",
  executable,
  "--animation",
  animationPath,
  "--animation-sha256",
  animationDigest,
  "--rig",
  rigPath,
  "--rig-sha256",
  sha256(rig),
  "--clip",
  clipPath,
  "--receipt",
  receiptPath,
]);
assert.equal(result.exitCode, 0, result.stderr.toString());
assert.equal(
  sha256(await readFile(clipPath)),
  routeDigest(chaosTurretCollapsePaths.clip),
);
const receipt = await Bun.file(receiptPath).json();
assert.equal(receipt.originalPoseEvaluationExecuted, true);
assert.equal(receipt.rewindMatchesZero, true);
assert.equal(receipt.resourceFrames, 58);
assert.equal(receipt.resourceFps, 30);
console.log(
  JSON.stringify({
    output: out,
    clipSha256: routeDigest(chaosTurretCollapsePaths.clip),
    visibilityFrames: visibility.map(([frame]) => frame),
  }),
);

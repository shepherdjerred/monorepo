import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { openReplay } from "../../transport.mjs";
import { readLocalRecordedParticles } from "../build-local-scout-terrain-package.mjs";
import { assertRecordedRiftEffectBuild } from "./recorded-rift-effect-packets.mjs";
import {
  compileRecordedSennaFlare,
  readRecordedSennaFlareAssets,
} from "./recorded-senna-w-flare-source.mjs";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    "base-track": { type: "string" },
    "base-track-sha256": { type: "string" },
  },
});
const [referenceTrack, replayPath, catalogPath, catalogDigest, destination] =
  positionals;
assert.equal(
  positionals.length,
  5,
  "Usage: bun prepare-recorded-senna-w-billboards.mjs REFERENCE_TRACK REPLAY CATALOG CATALOG_SHA256 NEW_CACHE_DIRECTORY [--base-track TRACK --base-track-sha256 SHA256]",
);
const basePath = values["base-track"];
const baseDigest = values["base-track-sha256"];
assert.equal(
  basePath === undefined,
  baseDigest === undefined,
  "Supply both base track and digest",
);
const directory = resolve(destination);
const parent = relative(
  await realpath(".cache"),
  await realpath(dirname(directory)),
);
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u)[0] !== "..");

const sha = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const [replayBytes, catalogBytes] = await Promise.all([
  Bun.file(replayPath).arrayBuffer(),
  readFile(catalogPath),
]);
assert.match(catalogDigest, /^[a-f\d]{64}$/u);
assert.equal(sha(catalogBytes), catalogDigest, "Effect catalog digest differs");
const replay = openReplay(replayBytes);
assertRecordedRiftEffectBuild(replay);
const replaySha256 = sha(replayBytes);
const catalog = JSON.parse(catalogBytes);
assert.equal(catalog.schema, 1);
assert.equal(catalog.kind, "recorded-rift-effect-source-catalog");
assert.equal(catalog.scope, "authored-definitions-and-packet-evidence");
assert.equal(catalog.build, replay.build);
assert.equal(catalog.protocol, replay.protocol);
assert.equal(catalog.replaySha256, replaySha256);
assert.equal(
  catalog.executableSha256,
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7",
);
for (const window of [catalog.creationWindow, catalog.stopWindow]) {
  assert.equal(window[0], 0, "Catalog must cover the start of the replay");
  assert.ok(
    window[1] > replay.duration,
    "Catalog must cover the end of the replay",
  );
}

const { effects, candidates, omitted } = compileRecordedSennaFlare({
  events: catalog.events,
  stops: catalog.stops,
  bindings: catalog.openingRoster,
  definitions: catalog.definitions,
  durationSeconds: replay.duration,
});
if (effects.length === 0) {
  console.log(
    JSON.stringify({
      status: "no-eligible-effects",
      candidates,
      omitted,
    }),
  );
  process.exit(0);
}

const { family, textures, shaders, files } =
  await readRecordedSennaFlareAssets(referenceTrack);
const identity = { build: replay.build, replaySha256 };
const standalone = {
  schema: 7,
  kind: "recorded-native-terrain-particles",
  ...identity,
  status: "verified-partial-effects",
  scope: "native-sampled-cold-remap",
  effects,
  families: [family],
  textures,
  shaders,
};
const manifest = "recorded-particles.json";
let track = standalone;
let packageFiles = files;
if (basePath !== undefined) {
  packageFiles = await readLocalRecordedParticles(
    basePath,
    baseDigest,
    identity,
  );
  track = JSON.parse(packageFiles.get(manifest));
  assert.ok(track.schema === 5 || track.schema === 6);
  assert.equal(track.shaders.vertex, shaders.vertex);
  assert.equal(track.shaders.fragment, shaders.fragment);
  const existingFamily = track.families.find(({ id }) => id === family.id);
  if (existingFamily === undefined) track.families.push(family);
  else assert.deepEqual(existingFamily, family);
  track.effects = [
    ...track.effects.filter((effect) => effect.family !== family.id),
    ...effects,
  ].sort((left, right) => left.start - right.start);
  assert.equal(
    new Set(track.effects.map(({ handle }) => handle)).size,
    track.effects.length,
    "Compiled placements collide with another effect family",
  );
  track.textures.files = [
    ...new Set([...track.textures.files, ...textures.files]),
  ];
  for (const [path, bytes] of files) {
    const existing = packageFiles.get(path);
    if (existing === undefined) packageFiles.set(path, bytes);
    else assert.deepEqual(existing, bytes);
  }
}
const payload = JSON.stringify(track);
const manifestPath = join(directory, manifest);
packageFiles.set(manifest, payload);
await mkdir(directory);
await mkdir(join(directory, "recorded-particles"));
await Promise.all(
  [...packageFiles].map(([path, bytes]) =>
    writeFile(join(directory, path), bytes, { flag: "wx" }),
  ),
);
const sha256 = sha(payload);
await readLocalRecordedParticles(manifestPath, sha256, identity);
console.log(
  JSON.stringify({
    manifest: manifestPath,
    sha256,
    candidates,
    effects: effects.length,
    omitted,
  }),
);

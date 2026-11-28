import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readLocalRecordedParticles } from "../build-local-scout-terrain-package.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { openLocalWad } from "../wad.mjs";

const [
  source,
  catalogPath,
  fightPath,
  stopPath,
  lowPath,
  highPath,
  nativePath,
  installation,
  converter,
  out,
] = process.argv.slice(2);
assert.equal(
  process.argv.length,
  12,
  "Usage: bun prepare-recorded-senna-w-flare.mjs TRACK CATALOG CREATE STOP CONTROL_LOW CONTROL_HIGH SEEDED INSTALLATION TEXTURE_CONVERTER NEW_CACHE_DIRECTORY",
);
const directory = resolve(out);
const cache = await realpath(".cache");
const parent = relative(cache, await realpath(dirname(directory)));
assert.ok(!isAbsolute(parent) && parent.split(/[\\/]/u)[0] !== "..");

const identity = {
  build: "16.23.841.8428",
  replaySha256:
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
};
const sha = (value) => Bun.CryptoHasher.hash("sha256", value, "hex");
const catalogDigest =
  "9dd0fa59cc4f827f84ed211a0dc57c7d4f9d079a1b8279e302a00eab841fe6d6";
const textureHash =
  "3b38892fe260d501aa7ae6f2d3026d7cf28e9b92f88beb0b72060282e41ca44d";
const texture = `recorded-particles/${textureHash}.png`;
// The archive constructor selects DefaultColorOverlifetime.png. The matching
// WAD mip from DefaultColorOverlifetime.tex is already pinned by this track.
const palette =
  "recorded-particles/9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a.png";

async function readPinned(path, digest) {
  const bytes = await readFile(path);
  assert.equal(sha(bytes), digest, `Changed reviewed input: ${path}`);
  return bytes;
}

const readJson = async (path, digest) =>
  JSON.parse(await readPinned(path, digest));
async function readNative(path, digest) {
  const json = (await readFile(path, "utf8")).trimEnd();
  assert.equal(sha(json), digest, `Changed reviewed native probe: ${path}`);
  return JSON.parse(json);
}

const [files, catalog, fight, stop, low, high, native] = await Promise.all([
  readLocalRecordedParticles(
    source,
    "60eb58accb5045e7a0f7f20ac705cd28deb257d9bcfe6e0f9e3658982dfa68db",
    identity,
  ),
  readJson(catalogPath, catalogDigest),
  readJson(
    fightPath,
    "a81ef3bd9669e5f04966c03d50518bd6a184bdbd2892753f7d4508334266c104",
  ),
  readJson(
    stopPath,
    "cdd576cee8a3507ccbd4f20e93c98a2f883b53e1ade21bc05b01ae69c3f4def5",
  ),
  readNative(
    lowPath,
    "a7408cb3fce0bccd04b4b1333e409c20e8d95787a37f99bd7690e2a5a9ea7dc4",
  ),
  readNative(
    highPath,
    "4890ca4fed5bc0f34628cc9bde3a080f1e451a1dcfba8d6f878add520abe73eb",
  ),
  readNative(
    nativePath,
    "3bd6a2ffb80aeb0801172fc06bc16d233ba8ca1ab9e635ba4b03c553676bc15b",
  ),
]);

const manifest = "recorded-particles.json";
const track = JSON.parse(files.get(manifest));
assert.equal(track.schema, 6);
assert.equal(catalog.replaySha256, track.replaySha256);
assert.equal(fight.replaySha256, track.replaySha256);
assert.equal(stop.replaySha256, track.replaySha256);
assert.ok(files.has(palette));
assert.ok(!files.has(texture));

const handle = 1073821562;
const key = 0x6bb08197;
const family = "senna-w-ground-impact-flare";
const lifetime = Math.fround(0.12);
const candidates = fight.events.filter(
  ({ resourceKey }) => resourceKey === key,
);
assert.equal(candidates.length, 1);
const [event] = candidates;
assert.equal(event.handle, handle);
assert.equal(event.owner, 1073742165);
assert.equal(event.status, "detached-placement-confirmed");
assert.equal(event.context, 0);
assert.equal(event.parent, 0);
assert.equal(event.descriptor.flags, 0x20);
assert.equal(event.descriptor.resourceKey, key);
assert.deepEqual(event.descriptor.scaleRate, [Math.fround(0.9), 1]);
const [position, second, third] = event.descriptor.positions;
assert.deepEqual(second, [0, 0, 0]);
assert.deepEqual(third, [0, 0, 0]);
assert.ok(
  event.stamp >= stop.window[0] && event.stamp + lifetime <= stop.window[1],
);
assert.ok(!stop.events.some(({ target }) => target === handle));
const catalogEvent = catalog.events.find((row) => row.handle === handle);
assert.equal(catalogEvent.packetSha256, event.packetSha256);
assert.equal(catalogEvent.definitionKey, "senna-18:6bb08197");
const definition = catalog.definitions[catalogEvent.definitionKey];
assert.equal(definition.source.particleName, "Senna_Skin16_W_hit_impact");

const indices = "000001000200000002000300";
const twoIndices = indices + "040005000600040006000700";
const sampleDigest = sha(`${track.replaySha256}:${handle}`);
assert.equal(
  native.seedHex,
  Buffer.from(sampleDigest.slice(0, 16), "hex").reverse().toString("hex"),
);
assert.deepEqual(low.rngSamples, [0.125, 0.125, 0.125, 0.125]);
assert.deepEqual(high.rngSamples, [0.875, 0.875, 0.875, 0.875]);
assert.deepEqual(low.timeline, high.timeline);
assert.deepEqual(low.timeline, native.timeline);
for (const control of [low, high, native]) {
  assert.equal(control.archiveSha256, fight.executableSha256);
  assert.equal(control.authoredSha256, catalogDigest);
  assert.equal(control.material.pass, 4);
  assert.equal(
    control.material.descriptorHex,
    "3f0000000403000000000606010100010f000000000000000000000000000000",
  );
  assert.deepEqual(control.material.parameters, [
    ["ALPHA_TEST", 1],
    ["AlphaTestReferenceValue", [Math.fround(5 / 255), 0, 0, 0]],
  ]);
  assert.deepEqual(control.material.stages, [
    "ParticleSystem/QUAD_PS.ps",
    "ParticleSystem/QUAD_VS.vs",
  ]);
  assert.equal(control.material.defineCount, 0);
  assert.equal(control.material.requestFlagsHex, "00000000000000000000");
  assert.equal(control.updates.length, 1);
  assert.equal(control.updates[0].birthClockSeconds, 0);
  assert.equal(control.updates[0].birthCount, 2);
  assert.equal(control.inserts.length, 2);
  for (const row of control.inserts) {
    assert.deepEqual(row.position, [0, 0, 0]);
    assert.equal(row.birthClock, 0);
    assert.equal(row.lifetime, lifetime);
  }
  for (const [age, count, geometry] of control.timeline) {
    if (age <= lifetime) {
      assert.equal(count, 2);
      assert.equal(geometry.indexBytes, twoIndices);
      assert.match(geometry.vertexBytes, /^[a-f\d]{448}$/u);
    } else {
      assert.equal(count, 0);
      assert.equal(geometry, null);
    }
  }
  assert.equal(control.timeline.at(-4)[0], lifetime);
  const terminal = Buffer.from(control.timeline.at(-4)[2].vertexBytes, "hex");
  // The native update still writes vertices at the lifetime boundary. They
  // have collapsed to the origin and cannot cover any fragment.
  for (let offset = 0; offset < terminal.length; offset += 28) {
    for (const axis of [0, 4, 8])
      assert.equal(terminal.readFloatLE(offset + axis), 0);
  }
  assert.ok(control.timeline.at(-3)[0] > lifetime);
}

const samples = native.timeline.filter(([age]) => age < lifetime);
const components = [0, 224].map((start) => ({
  texture,
  palette,
  centerY: 0,
  alphaTest: true,
  depthTest: false,
  blend: "src-alpha-one",
  indices,
  lifetime,
  samples: samples.map(([age, , { vertexBytes }]) => {
    const vertices = vertexBytes.slice(start, start + 224);
    const bytes = Buffer.from(vertices, "hex");
    for (let offset = 0; offset < bytes.length; offset += 28)
      assert.equal(bytes.readFloatLE(offset + 8), 0);
    return { age, vertices };
  }),
}));

const wad = await openLocalWad(
  installation,
  definition.archive,
  Bun.zstdDecompressSync,
  definition.archiveIndexSha256,
);
const sourceBin = await wad(definition.source.path);
assert.equal(sha(sourceBin), definition.source.sha256);
const original = readExactMapBin(sourceBin).objects.find(
  (row) => row.pathHash === definition.definition.pathHash,
);
assert.deepEqual(original, definition.definition);
const emitter = original.fields["868eb76a"].elements[10].fields;
assert.equal(emitter["3d25b8ce"].value, "BigLensFlare1");
const originalTexture = emitter["3c6468f4"].value;
const media = definition.media.find(
  (row) => row.reference === originalTexture.toLowerCase(),
);
assert.equal(media.status, "owner-archive");
const rawTexture = await wad(originalTexture);
assert.equal(sha(rawTexture), media.sha256);

const staging = await mkdtemp(join(cache, "senna-w-mip-"));
const rawPath = join(staging, "flare.tex");
const pngPath = join(staging, "flare.png");
const jobsPath = join(staging, "jobs.json");
let png;
try {
  await writeFile(rawPath, rawTexture, { flag: "wx" });
  await writeFile(jobsPath, JSON.stringify({ [rawPath]: pngPath }), {
    flag: "wx",
  });
  const conversion = Bun.spawnSync(["dotnet", resolve(converter), jobsPath]);
  assert.equal(conversion.exitCode, 0, conversion.stderr.toString());
  assert.deepEqual(JSON.parse(conversion.stdout.toString())[rawPath], {
    mipLevel: 0,
    width: 128,
    height: 128,
  });
  png = await readPinned(pngPath, textureHash);
} finally {
  await Promise.all(
    [rawPath, pngPath, jobsPath].map((path) => rm(path, { force: true })),
  );
  await rmdir(staging);
}

assert.ok(!track.effects.some((old) => old.handle === handle));
assert.ok(!track.families.some((old) => old.id === family));
track.effects.push({ handle, start: event.stamp, position, family });
track.effects.sort((a, b) => a.start - b.start || a.handle - b.handle);
track.families.push({ id: family, components });
track.textures.files.push(texture);
const payload = JSON.stringify(track);
files.set(manifest, payload);
files.set(texture, png);

await mkdir(directory);
await mkdir(join(directory, "recorded-particles"));
await Promise.all(
  [...files].map(([path, bytes]) =>
    writeFile(join(directory, path), bytes, { flag: "wx" }),
  ),
);
const sha256 = sha(payload);
await readLocalRecordedParticles(join(directory, manifest), sha256, identity);
console.log(
  JSON.stringify({ manifest: join(directory, manifest), sha256, handle }),
);

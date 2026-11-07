// Validate every original initial hero packet before expanding native admission.
// This checks packet identity/decoding; it does not instantiate match entities.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestFieldReader } from "../latest-fields.mjs";
import { compareStructural, sha256 } from "../structural-comparison.mjs";

const [cachePath] = process.argv.slice(2);
if (!cachePath) throw Error("Usage: bun inspect-initial-heroes.mjs <cache>");
const cache = resolve(cachePath);
const inputs = {};
const bytes = async (path) => {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await bytes(path)),
  );
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-fields.mjs"),
  resolve(import.meta.dir, "../movement-records.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
  resolve(import.meta.dir, "../structural-decoder.mjs"),
  resolve(import.meta.dir, "../native-decoder.mjs"),
])
  await bytes(path);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const codecsPath = `${cache}/public/decoder-16.21-macos/field-codecs.json`;
const codecs = await read(codecsPath);
const samples = await read(`${cache}/research/initial-heroes-input.json`);
const native = await read(`${cache}/research/initial-heroes-native.json`);
const semantics = await read(`${cache}/research/latest-semantics-effects.json`);
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
await bytes(runtimePath);
const { default: createUnicorn } = await import(pathToFileURL(runtimePath));
const comparison = await compareStructural({
  uc: await createUnicorn(),
  profile,
  image: await bytes(`${cache}/public/decoder-16.21-macos/image.bin`),
  constructors: await bytes(
    `${cache}/public/decoder-16.21-macos/constructors.bin`,
  ),
  samples,
  oracle: native,
});
const fields = createLatestFieldReader(profile, codecs);
if (
  inputs[codecsPath] !== profile.fieldCodecsSha256 ||
  samples.build !== profile.clientVersion ||
  samples.protocol !== profile.protocolDigest ||
  semantics.build !== samples.build ||
  semantics.protocol !== samples.protocol ||
  semantics.replaySha256 !== samples.replaySha256 ||
  native.clientVersion !== samples.build ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.constructorImageSha256 !== profile.constructorImageSha256 ||
  comparison.build !== samples.build ||
  comparison.mismatches !== 0 ||
  comparison.unresolved !== 0 ||
  comparison.matched !== semantics.heroes.length ||
  semantics.heroes.length !== 10 ||
  Object.keys(samples.packets).length !== semantics.heroes.length ||
  Object.keys(native.observations).length !== semantics.heroes.length
)
  throw Error("Initial hero inputs differ from the exact-build replay roster");
const identities = new Set();
const slots = new Set();
const heroes = [];
for (const [key, sample] of Object.entries(samples.packets)) {
  const observed = native.observations[key];
  if (
    sample.opcode !== 1049 ||
    sample.stream !== 2 ||
    sample.time !== 0 ||
    sample.param !== 0 ||
    observed?.status !== "complete" ||
    observed.opcode !== 1049 ||
    observed.param !== sample.param ||
    observed.payloadSha256 !==
      (await sha256(Buffer.from(sample.payloadHex, "hex")))
  )
    throw Error(`Initial hero packet framing or observation differs: ${key}`);
  const hero = fields.heroCreation({
    complete: true,
    object: new Uint8Array(Buffer.from(observed.object, "hex")),
    heap: new Uint8Array(Buffer.from(observed.heap, "hex")),
  });
  const roster = semantics.heroes.find((row) => row.entityId === hero.entityId);
  if (
    !roster ||
    identities.has(hero.entityId) ||
    slots.has(hero.slot) ||
    Object.entries(hero).some(
      ([field, value]) =>
        JSON.stringify(value) !== JSON.stringify(roster[field]),
    )
  )
    throw Error(
      `Initial hero packet does not uniquely match the decoded roster: ${key}`,
    );
  identities.add(hero.entityId);
  slots.add(hero.slot);
  heroes.push({
    key,
    chunkId: sample.chunkId,
    blockOffset: sample.blockOffset,
    payloadSha256: observed.payloadSha256,
    ...hero,
  });
}
for (const [path, hash] of Object.entries(inputs))
  if (
    (await sha256(new Uint8Array(await Bun.file(path).arrayBuffer()))) !== hash
  )
    throw Error(`Initial hero comparison input changed: ${path}`);
const output = `${cache}/research/initial-heroes-identity.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: samples.build,
      protocol: samples.protocol,
      replaySha256: samples.replaySha256,
      heroes,
      comparison,
      inputs,
      scope: {
        nativeAndBrowserPacketAgreement: true,
        liveEntitiesCreated: false,
        resourceStacksRecovered: false,
        matchAppearanceVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output, heroes: heroes.length, liveEntitiesCreated: false }),
);

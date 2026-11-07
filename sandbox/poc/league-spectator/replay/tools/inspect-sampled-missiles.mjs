// Research-only field extraction from already compared native sample objects.
// Browser playback continues to decode the original replay through WASM.
import { resolve } from "node:path";
import { createLatestFieldReader } from "../latest-fields.mjs";

const [startupPath, decoderPath, nativePath, corpusPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-sampled-missiles.mjs <startup-semantics> <decoder-dir> <native-objects> <sample-corpus> <output>",
  );
const decoder = resolve(decoderPath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  codecs = await Bun.file(`${decoder}/field-codecs.json`).arrayBuffer(),
  startup = await Bun.file(startupPath).json(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  corpusBytes = await Bun.file(corpusPath).arrayBuffer(),
  corpus = JSON.parse(new TextDecoder().decode(corpusBytes)),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  profile.clientVersion !== startup.build ||
  profile.protocolDigest !== startup.protocol ||
  corpus.build !== startup.build ||
  corpus.protocol !== startup.protocol ||
  corpus.replaySha256 !== startup.replaySha256 ||
  native.clientVersion !== startup.build ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.constructorImageSha256 !== profile.constructorImageSha256 ||
  hash(codecs) !== profile.fieldCodecsSha256
)
  throw Error("Sampled missile field package mismatch");
const fields = createLatestFieldReader(
    profile,
    JSON.parse(new TextDecoder().decode(codecs)),
  ),
  missiles = [];
for (const [key, packet] of Object.entries(corpus.packets)) {
  if (packet.opcode !== 28) continue;
  const observation = native.observations[key],
    payload = Buffer.from(packet.payloadHex, "hex");
  if (
    !observation ||
    observation.opcode !== 28 ||
    observation.status !== "complete" ||
    observation.param !== packet.param ||
    hash(payload) !== observation.payloadSha256
  )
    throw Error(`Unmatched native missile sample ${key}`);
  const record = fields.missile({
    complete: true,
    object: new Uint8Array(Buffer.from(observation.object, "hex")),
    heap: new Uint8Array(Buffer.from(observation.heap, "hex")),
  });
  missiles.push({
    ...record,
    time: packet.time,
    sequence: missiles.length,
    stream: packet.stream,
    chunkId: packet.chunkId,
    blockOffset: packet.blockOffset,
    payloadSha256: observation.payloadSha256,
    sampleKey: key,
  });
}
const result = {
  schema: 1,
  status: "native-sampled-missile-fields",
  build: startup.build,
  protocol: startup.protocol,
  replaySha256: startup.replaySha256,
  heroes: startup.heroes,
  missiles,
  missileEvents: [],
  fieldCodecsSha256: profile.fieldCodecsSha256,
  decoderImageSha256: profile.decoderImageSha256,
  constructorImageSha256: profile.constructorImageSha256,
  nativeObjectsSha256: hash(nativeBytes),
  corpusSha256: hash(corpusBytes),
  scope:
    "Native object sample fields for component inspection only; startup appearances are static bindings, runtime appearance/spell changes and complete match reconstruction remain unverified",
};
await Bun.write(outputPath, JSON.stringify(result));
console.log(
  JSON.stringify({
    samples: missiles.length,
    positiveElapsed: missiles.filter((m) => m.elapsedSeconds > 0).length,
  }),
);

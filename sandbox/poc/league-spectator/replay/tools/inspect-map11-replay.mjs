// Execute original exact-build decoders without requiring an admitted scene.
// This is an evidence producer, not a replacement gameplay decoder or renderer.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { createLatestFieldReader } from "../latest-fields.mjs";
import { createLatestStartupConfig } from "../latest-startup-config.mjs";
import { readLatestReplayStartup } from "../latest-replay-startup.mjs";
import { prepareLatestMovement } from "../latest-movement.mjs";
import {
  createLatestParticipantReader,
  bindLatestHeroParticipant,
} from "../latest-participants.mjs";

const [assetsArg, replayArg, mapArg, outputArg, endArg = "120"] =
  process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun inspect-map11-replay.mjs <approved-public-assets> <replay.rofl> <prepared-map11-scene> <output.json> [end-seconds]",
  );
const assets = resolve(assetsArg),
  map = resolve(mapArg),
  inputs = {};
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(path) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[resolve(path)] = sha(bytes);
  return bytes;
}
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const root = `${assets}/decoder-16.21-macos`;
const profile = await json(`${root}/profile.json`);
const image = await raw(`${root}/image.bin`),
  constructors = await raw(`${root}/constructors.bin`);
const fieldBytes = await raw(`${root}/field-codecs.json`),
  runtimePath = `${assets}/vendor/unicorn_x86_candidate.mjs`;
const runtime = await json(runtimePath.replace(/\.mjs$/, ".json"));
if (
  sha(image) !== profile.decoderImageSha256 ||
  sha(constructors) !== profile.constructorImageSha256 ||
  sha(fieldBytes) !== profile.fieldCodecsSha256 ||
  sha(await raw(runtimePath)) !== runtime.sha256
)
  throw Error("Original decoder input integrity mismatch");
const compressionPath = `${assets}/vendor/fzstd.mjs`;
await raw(compressionPath);
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const { decompress } = await import(pathToFileURL(compressionPath).href);
const buffer = await raw(replayArg),
  replay = openReplay(buffer.buffer);
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Replay does not match original decoder build/protocol");
const endTime = Number(endArg),
  scene = await json(`${map}/manifest.json`);
if (
  !Number.isFinite(endTime) ||
  endTime < 0 ||
  endTime > replay.duration ||
  scene.map.id !== 11 ||
  scene.build !== replay.build ||
  scene.protocol !== replay.protocol
)
  throw Error("Exact recorded build and prepared Map11 window required");
const reader = await createLatestStartupConfig({
  profile,
  image,
  packageBytes: await raw(`${assets}/latest-startup-config/package.json`),
});
const decoder = new StructuralDecoder(
  await createUnicorn(),
  profile,
  image,
  constructors,
);
const fields = createLatestFieldReader(
  profile,
  JSON.parse(new TextDecoder().decode(fieldBytes)),
);
const participantReader = await createLatestParticipantReader({
  profile,
  image,
});
const heroes = [],
  worldEvents = [],
  movement = [],
  unsupported = [],
  decodedPackets = {};
let sequence = 0,
  transportSequence = 0,
  startup;
try {
  startup = await readLatestReplayStartup({
    replay,
    decompress,
    decoder,
    reader,
    participantReader,
    sceneBytes: new TextEncoder().encode(JSON.stringify(scene)),
  });
  for (const chunk of replayChunks(replay, decompress, {
    streams: [1, 2, 3],
  })) {
    for (const block of replayBlocks(chunk)) {
      if (chunk.stream === 3) {
        if (block.opcode !== 728) continue;
        const observed = decoder.observePacket(728, block.payload, block.param);
        const view = new DataView(
          observed.object.buffer,
          observed.object.byteOffset,
          observed.object.byteLength,
        );
        const pointer = Number(view.getBigUint64(0x1e8, true)) - 0x10200000;
        const length = view.getUint32(0x1f0, true),
          capacity = view.getUint32(0x1f4, true);
        if (
          !observed.complete ||
          !Number.isSafeInteger(pointer) ||
          pointer < 568 ||
          length < 1 ||
          length > 128 ||
          capacity <= length ||
          pointer + capacity > observed.heap.length ||
          observed.heap[pointer + length] !== 0
        )
          throw Error(
            "Recorded map-skin text exceeds original startup allocation",
          );
        startup.recordedMapSkin = new TextDecoder("utf-8", {
          fatal: true,
        }).decode(observed.heap.subarray(pointer, pointer + length));
        startup.mapSkinField = {
          packetOffset: 0x1e8,
          configurationOffset: 0x58,
          consumerRvas: [0x61f287, 0x61f329, 0x62023c, 0x60c3f9, 0x60c419],
          scope:
            "Original decoded field; full map bootstrap and variant-to-geometry selection remain separate",
        };
        continue;
      }
      const ordinal = transportSequence++;
      const initial = chunk.stream === 2 && block.time === 0;
      const gameplay = chunk.stream === 1 && block.time <= endTime;
      if (!(
        (initial && [1049, 1005, 1084, 849].includes(block.opcode)) ||
        (gameplay && [649, 657, 1084, 849].includes(block.opcode))
      ))
        continue;
      const observed = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
      );
      if (!observed.complete)
        throw Error(`Original packet decoder incomplete ${block.opcode}`);
      const provenance = {
        time: block.time,
        sequence: sequence++,
        transportSequence: ordinal,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
      };
      decodedPackets[block.opcode] = (decodedPackets[block.opcode] ?? 0) + 1;
      if ([649, 657].includes(block.opcode)) {
        for (const event of fields.movement(observed, "signed8"))
          movement.push({ ...event, ...provenance });
      } else if (block.opcode === 1049) {
        const hero = fields.heroCreation(observed);
        heroes.push({
          ...hero,
          ...bindLatestHeroParticipant(hero, startup.participants, replay),
          provenance,
        });
      } else {
        try {
          const event =
            block.opcode === 1005
              ? fields.buildingIdentity(observed)
              : block.opcode === 849
                ? fields.npcCreation(observed)
                : fields.laneMinionCreation(observed);
          worldEvents.push({ ...event, ...provenance });
        } catch (error) {
          unsupported.push({
            opcode: block.opcode,
            error: String(error),
            ...provenance,
            originalObjectHex: Buffer.from(observed.object).toString("hex"),
            originalHeapHex: Buffer.from(observed.heap).toString("hex"),
          });
        }
      }
    }
  }
} finally {
  decoder.close();
}
const report = {
  schema: 1,
  kind: "original-map11-world-inspection",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: sha(buffer),
  endTime,
  duration: replay.duration,
  startup,
  heroes,
  worldEvents,
  movement,
  unsupported,
  decodedPackets,
  inputs,
  sourceSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
  scope: {
    originalDecoderExecuted: true,
    sceneAdmission: false,
    nativeSpectatorEquivalent: false,
  },
};
const prepared = prepareLatestMovement(report, scene.map);
report.movementEvidence = {
  origin: scene.map.movementOrigin,
  tracks: prepared.tracks.size,
  accepted: prepared.accepted,
  rejected: prepared.rejected.length,
};
await Bun.write(outputArg, JSON.stringify(report));
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    startup,
    heroes: heroes.length,
    worldEvents: worldEvents.length,
    npcSkins: [
      ...new Set(
        worldEvents
          .filter((e) => e.character)
          .map((e) => `${e.character}/${e.skinId}`),
      ),
    ],
    unsupported: unsupported.map((e) => e.error),
    movement: movement.length,
    movementEvidence: report.movementEvidence,
  }),
);

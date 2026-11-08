import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestResourceRequestReader } from "../latest-resource-requests.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const inputs = {},
  loaded = new Map();
const raw = (path) => {
  if (!loaded.has(path))
    loaded.set(
      path,
      (async () => {
        const bytes = await Bun.file(path).bytes();
        inputs[path] = await sha256(bytes);
        return bytes;
      })(),
    );
  return loaded.get(path);
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const constructors = await raw(
  `${cache}/public/decoder-16.21-macos/constructors.bin`,
);
const readerInputs = {
  profile,
  image,
  appearancePackageBytes: await raw(
    `${cache}/public/latest-appearance-stack-inputs/package.json`,
  ),
  formPackageBytes: await raw(
    `${cache}/public/latest-unit-form-inputs/package.json`,
  ),
};
const reader = await createLatestResourceRequestReader(readerInputs);
let incompatiblePackageRejections = 0;
for (const key of ["appearancePackageBytes", "formPackageBytes"]) {
  const bytes = readerInputs[key].slice();
  bytes[0] ^= 1;
  try {
    await createLatestResourceRequestReader({ ...readerInputs, [key]: bytes });
  } catch {
    incompatiblePackageRejections++;
  }
}
if (incompatiblePackageRejections !== 2)
  throw Error("Resource field reader admitted incompatible package bytes");
// The fixture has no opcode965. An explicit encoded-field control verifies its
// unresolved producer status without inventing a replay event or accepted copy.
const appearanceMeta = JSON.parse(
  new TextDecoder().decode(readerInputs.appearancePackageBytes),
);
const copyObject = new Uint8Array(appearanceMeta.packets[965].objectSize);
const copyView = new DataView(copyObject.buffer);
copyView.setUint32(8, 965, true);
copyView.setUint32(12, 10, true);
const sourceField = appearanceMeta.packets[965].fields.sourceEntityId;
for (let lane = 0; lane < sourceField.width; lane++)
  copyObject[sourceField.offset + lane] = sourceField.decode[lane].indexOf(
    (20 >>> (lane * 8)) & 255,
  );
const copyControl = reader.read(
  {
    opcode: 965,
    param: 10,
    time: 0,
    transportSequence: 0,
    stream: 1,
    chunkId: 1,
    blockOffset: 1,
  },
  { complete: true, object: copyObject, heap: copyObject.slice() },
);
if (
  copyControl.sourceEntityId !== 20 ||
  copyControl.producerStatus !== "copy-producer-unresolved" ||
  copyControl.acceptedByLiveUnit !== null ||
  copyControl.resourceIdentity !== null
)
  throw Error("Copy request control escaped its unresolved producer boundary");
const appearance = await read(`${cache}/research/appearance-packets.json`);
const forms = await read(`${cache}/research/unit-form-inputs-comparison.json`);
if (
  appearance.build !== profile.clientVersion ||
  appearance.protocol !== profile.protocolDigest ||
  appearance.decoderImageSha256 !== profile.decoderImageSha256 ||
  forms.mismatchCount !== 0
)
  throw Error("Matching original appearance/form evidence required");
for (const reference of [appearance, forms]) {
  for (const [path, expected] of Object.entries(reference.inputs))
    if ((await sha256(await raw(path))) !== expected)
      throw Error(`Stale request evidence input: ${path}`);
  for (const [path, expected] of Object.entries(reference.sources))
    if ((await sha256(await raw(resolve(root, path)))) !== expected)
      throw Error(`Stale request evidence source: ${path}`);
}
for (const file of [
  "latest-resource-requests.mjs",
  "latest-resource-requests.test.mjs",
  "latest-appearance-stack-inputs.mjs",
  "latest-unit-form-inputs.mjs",
  "structural-decoder.mjs",
  "native-decoder.mjs",
  "transport.mjs",
  "tools/inspect-resource-requests.mjs",
])
  await raw(resolve(root, file));
const installation = await read(`${cache}/latest-installation.json`);
const replayBytes = await raw(installation.replay.file);
const replay = openReplay(
  replayBytes.buffer.slice(
    replayBytes.byteOffset,
    replayBytes.byteOffset + replayBytes.byteLength,
  ),
);
if (
  (await sha256(replayBytes)) !== installation.replay.sha256 ||
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Exact-build original replay required");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
const { default: factory } = await import(
  pathToFileURL(`${cache}/public/vendor/unicorn_x86_candidate.mjs`).href
);
const native = new StructuralDecoder(
  await factory(),
  profile,
  image,
  constructors,
);
const referenceRecords = [...appearance.records, ...forms.records];
const expected = new Map(
  referenceRecords.map((event) => [event.transportSequence, event]),
);
if (expected.size !== referenceRecords.length)
  throw Error("Duplicate compared request ordinal");
const records = [];
let ordinal = 0,
  comparisons = 0;
try {
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const transportSequence = ordinal++;
      if (!reader.opcodes.includes(block.opcode)) continue;
      const event = reader.read(
        {
          ...block,
          stream: chunk.stream,
          chunkId: chunk.chunkId,
          transportSequence,
        },
        native.observePacket(block.opcode, block.payload, block.param),
      );
      const reference = expected.get(transportSequence);
      if (!reference)
        throw Error(
          "Decoded resource request has no compared original ordinal",
        );
      for (const key of Object.keys(reference).filter(
        (name) =>
          !["param", "payloadHex", "objectHex", "heapHex", "entryRva"].includes(
            name,
          ),
      )) {
        if (JSON.stringify(event[key]) !== JSON.stringify(reference[key]))
          throw Error(
            `Resource request decoded field differs: ${transportSequence}:${key}`,
          );
        comparisons++;
      }
      records.push(event);
    }
  }
} finally {
  native.close();
}
if (records.length !== referenceRecords.length)
  throw Error("Resource request capture count differs");
const track = reader.createTrack(records);
let queries = 0;
for (const event of [...records, ...records.toReversed()]) {
  for (const exclusive of [true, false]) {
    const query = track.requests(event.entityId, event.time, event.stream, {
      transportSequence: event.transportSequence,
      entryOrder: 0,
      exclusive,
    });
    const wanted = track.records.filter(
      (candidate) =>
        candidate.entityId === event.entityId &&
        candidate.stream === event.stream &&
        (candidate.time < event.time ||
          (candidate.time === event.time &&
            (candidate.transportSequence < event.transportSequence ||
              (!exclusive &&
                candidate.transportSequence === event.transportSequence)))),
    );
    if (JSON.stringify(query) !== JSON.stringify(wanted))
      throw Error("Original resource request causal seek differs");
    queries++;
  }
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Request evidence changed during verification: ${path}`);
const counts = {
  requests: records.length,
  fieldComparisons: comparisons,
  causalQueries: queries,
  incompatiblePackageRejections,
  syntheticCopyFieldControls: 1,
  byOpcode: Object.fromEntries(
    reader.opcodes.map((opcode) => [
      opcode,
      records.filter((event) => event.opcode === opcode).length,
    ]),
  ),
  gameplayRequests: records.filter((event) => event.stream === 1).length,
  snapshotRequests: records.filter((event) => event.stream === 2).length,
};
const output = `${cache}/research/resource-requests-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      contract: reader.contract,
      counts,
      inputs,
      mismatchCount: 0,
      scope: {
        originalBrowserCompatiblePacketDecoder: true,
        snapshotGameplayStreamsSeparate: true,
        allRequestsRetained: true,
        producerAcceptanceVerified: false,
        liveResourceStacksReconstructed: false,
        normalPlaybackIntegrated: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);

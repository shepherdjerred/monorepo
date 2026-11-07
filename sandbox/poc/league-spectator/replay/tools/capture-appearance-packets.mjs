// Local research observations from the original browser-compatible decoder.
// Neither replay events nor native object arenas are public build packages.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { createLatestAppearanceStackInputs } from "../latest-appearance-stack-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[path] = sha(bytes);
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  check = (value, message) => {
    if (!value) throw Error(message);
  },
  assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors = await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  packageBytes = await raw(
    `${assets}/latest-appearance-stack-inputs/package.json`,
  ),
  reference = await read(
    `${cache}/research/appearance-stack-inputs-comparison.json`,
  ),
  reader = await createLatestAppearanceStackInputs({
    profile,
    image,
    packageBytes,
  });
check(
  reference.mismatchCount === 0,
  "Matching appearance field comparison required",
);
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Appearance field input changed");
for (const [path, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/${path}`)) === digest,
    "Appearance field source changed",
  );
const installation = await read(`${cache}/latest-installation.json`),
  replayBytes = await raw(installation.replay.file),
  replay = openReplay(replayBytes.buffer),
  { decompress } = await import(
    pathToFileURL(`${assets}/vendor/fzstd.mjs`).href
  );
check(
  sha(replayBytes) === installation.replay.sha256 &&
    replay.build === profile.clientVersion &&
    replay.protocol === profile.protocolDigest,
  "Matching pinned replay required",
);
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new StructuralDecoder(uc, profile, image, constructors),
  records = [],
  expected = new Map(
    reference.records.map((record) => [record.transportSequence, record]),
  );
let sequence = 0;
try {
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const transportSequence = sequence++;
      if (![984, 459, 1045, 965].includes(block.opcode)) continue;
      const observed = native.observePacket(
          block.opcode,
          block.payload,
          block.param,
        ),
        decoded = reader.read(observed),
        previous = expected.get(transportSequence),
        fields = {
          ...decoded,
          time: block.time,
          stream: chunk.stream,
          chunkId: chunk.chunkId,
          blockOffset: block.blockOffset,
          transportSequence,
        };
      check(
        JSON.stringify(fields) === JSON.stringify(previous),
        "Original appearance capture differs from compared replay fields",
      );
      records.push({
        ...fields,
        param: block.param,
        payloadHex: Buffer.from(block.payload).toString("hex"),
        objectHex: Buffer.from(observed.object).toString("hex"),
        heapHex: Buffer.from(observed.heap).toString("hex"),
        entryRva: observed.entryRva,
      });
    }
  }
  check(
    records.length === expected.size,
    "Appearance capture omitted compared inputs",
  );
  await Bun.write(
    `${cache}/research/appearance-packets.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "original-wasm-appearance-packet-capture",
        build: profile.clientVersion,
        protocol: profile.protocolDigest,
        decoderImageSha256: sha(image),
        constructorImageSha256: sha(constructors),
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "tools/capture-appearance-packets.mjs",
              "structural-decoder.mjs",
              "native-decoder.mjs",
              "transport.mjs",
            ].map(async (path) => [
              path,
              sha(await Bun.file(`${root}/${path}`).bytes()),
            ]),
          ),
        ),
        records,
        scope: {
          localResearchOnly: true,
          originalDecoderExecutedInWasm: true,
          browserExecuted: false,
          liveUnitRouteVerified: false,
          mainViewerExpanded: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      packets: records.length,
      heapBytes: records.reduce((sum, r) => sum + r.heapHex.length / 2, 0),
    }),
  );
} finally {
  native.close();
}

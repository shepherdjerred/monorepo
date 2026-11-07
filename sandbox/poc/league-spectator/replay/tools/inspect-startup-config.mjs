// Decode real startup streams in WASM and compare the browser field reader to
// the original native configuration consumer. No browser or game process runs.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import {
  createLatestStartupConfig,
  STARTUP_CONFIG_SHA,
} from "../latest-startup-config.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  unhex = (h) => Uint8Array.from(Buffer.from(h, "hex")),
  assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors = await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  packageBytes = await raw(`${assets}/latest-startup-config/package.json`),
  nativeReference = await read(`${cache}/research/startup-mode-native.json`),
  nativeObjects = await read(`${cache}/research/startup-streams-native.json`),
  framing = await read(
    `${cache}/research/startup-streams-framing-comparison.json`,
  ),
  reader = await createLatestStartupConfig({ profile, image, packageBytes });
check(
  sha(packageBytes) === STARTUP_CONFIG_SHA &&
    reader.metadata.observationSha256 ===
      sha(await raw(`${cache}/research/startup-mode-native.json`)) &&
    framing.mismatches === 0 &&
    framing.matched === 2,
  "Original startup native evidence/package differs",
);
for (const [name, digest] of Object.entries(nativeReference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Startup producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(nativeReference.inputs))
  check(sha(await raw(path)) === digest, "Startup native input changed");
for (const b of nativeReference.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Executed startup instructions changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new StructuralDecoder(uc, profile, image, constructors),
  e = native.engine,
  installation = await read(`${cache}/latest-installation.json`),
  replayBytes = await raw(installation.replay.file),
  replay = openReplay(replayBytes.buffer),
  { decompress } = await import(
    pathToFileURL(`${assets}/vendor/fzstd.mjs`).href
  ),
  counts = {
    packetObjects: 0,
    startupConfigurations: 0,
    mapGetterComparisons: 0,
    boundaryRejections: 0,
  },
  results = [];
check(
  sha(replayBytes) === nativeReference.replaySha256 &&
    replay.build === profile.clientVersion &&
    replay.protocol === profile.protocolDigest,
  "Matching pinned startup replay required",
);
e.hook_add(
  uc.HOOK_CODE,
  () => e.emu_stop(),
  null,
  profile.imageBase + 0x61f2ef,
  profile.imageBase + 0x61f2ef,
);
function mapGetter(encoded) {
  e.context_restore(native.context);
  e.mem_write(0x10004000, new Uint8Array(0x20));
  e.mem_write(0x10004018, encoded);
  e.reg_write_i64(uc.X86_REG_RSI, 0x10004000n);
  e.reg_write_i64(uc.X86_REG_RBX, 0x10005000n);
  e.emu_start(
    profile.imageBase + 0x61f287,
    profile.imageBase + 0x61f2ef,
    0,
    10000,
  );
  check(
    Number(e.reg_read_i64(uc.X86_REG_RIP)) === profile.imageBase + 0x61f2ef,
    "WASM map field getter escaped",
  );
  return native.readU32(0x10005050);
}
try {
  let actualStartup;
  for (const chunk of replayChunks(replay, decompress)) {
    if (![3, 4].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const key = `${chunk.stream}:${chunk.chunkId}:${block.blockOffset}`,
        expected = nativeObjects.observations[key],
        o = native.observePacket(block.opcode, block.payload, block.param);
      check(
        expected?.status === "complete" &&
          o.complete &&
          o.consumed === expected.consumed &&
          Buffer.from(o.object).toString("hex") === expected.object &&
          Buffer.from(o.heap).toString("hex") === expected.heap,
        "Original native/WASM startup object differs",
      );
      counts.packetObjects++;
      if (block.opcode === 728) {
        check(
          chunk.stream === 3 && block.time === 0 && block.param === 0,
          "Startup packet stream/time differs",
        );
        const decoded = reader.read(o),
          map = mapGetter(o.object.subarray(0x88, 0x8c));
        check(
          decoded.mode === nativeReference.mode &&
            decoded.modeHash === nativeReference.modeHash &&
            decoded.configuredMapId === nativeReference.configuredMapId &&
            map === decoded.configuredMapId &&
            decoded.tftResourceSubsystemSelected ===
              nativeReference.tftFactorySelected,
          "Browser startup fields differ from original configuration consumer",
        );
        check(
          Object.isFrozen(decoded) && !decoded.liveResourceStacksRecovered,
          "Startup fields lost immutable scope",
        );
        actualStartup = o;
        counts.startupConfigurations++;
        counts.mapGetterComparisons++;
        results.push(decoded);
      }
    }
  }
  check(
    counts.packetObjects === 2 && counts.startupConfigurations === 1,
    "Expected startup packet coverage differs",
  );
  for (const p of nativeReference.mapIdProbes) {
    const encoded = unhex(p.encodedHex),
      actual = mapGetter(encoded);
    let translated = 0;
    for (let lane = 0; lane < 4; lane++)
      translated +=
        reader.metadata.mapIdCodec[lane][encoded[lane]] * 2 ** (lane * 8);
    check(
      actual === p.value && translated === p.value,
      "Native/WASM/JS mixed map getter differs",
    );
    counts.mapGetterComparisons++;
  }
  const changed = (offset, value, method = "setUint32") => {
    const object = actualStartup.object.slice(),
      heap = actualStartup.heap.slice();
    new DataView(object.buffer)[method](offset, value, true);
    heap.set(object);
    return { ...actualStartup, object, heap };
  };
  for (const bad of [
    changed(0xc0, 0xffffffff),
    changed(0xc4, 1),
    changed(0xb8, 0xffffffffffffffffn, "setBigUint64"),
    changed(8, 129),
    { ...actualStartup, complete: false },
  ]) {
    let rejected = false;
    try {
      reader.read(bad);
    } catch {
      rejected = true;
    }
    check(rejected, "Startup boundary admitted malformed input");
    counts.boundaryRejections++;
  }
  const bundle = await Bun.build({
    entrypoints: [`${root}/latest-startup-config.mjs`],
    target: "browser",
    write: false,
  });
  check(bundle.success, "Browser startup config module failed to bundle");
  await Bun.write(
    `${cache}/research/startup-config-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "startup-config-native-wasm-comparison",
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "latest-startup-config.mjs",
              "tools/inspect-startup-config.mjs",
            ].map(async (p) => [
              p,
              sha(await Bun.file(`${root}/${p}`).bytes()),
            ]),
          ),
        ),
        counts,
        results,
        mismatchCount: 0,
        scope: {
          actualRecordedStartupPacket: true,
          packetObjectsComparedInWasm: true,
          originalMapGetterExecutedInWasm: true,
          originalModeConsumerExecutedNatively: true,
          browserBundleBuilt: true,
          liveUnitResourceStackReconstructed: false,
          allOverlayProducersExcluded: false,
          mainViewerExpanded: false,
          browserExecuted: false,
          effectFactoryExecuted: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ counts, results, mismatchCount: 0 }));
} finally {
  native.close();
}

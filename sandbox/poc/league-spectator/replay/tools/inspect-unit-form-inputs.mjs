// Original native/WASM getter comparison and browser-compatible ROFL decoding.
// No live form table or effect resource identity is inferred from these requests.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import {
  createLatestUnitFormInputs,
  UNIT_FORM_INPUTS_SHA,
} from "../latest-unit-form-inputs.mjs";

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
  assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors = await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  packageBytes = await raw(`${assets}/latest-unit-form-inputs/package.json`),
  reference = await read(`${cache}/research/unit-form-inputs-native.json`),
  corpus = await read(`${cache}/research/structural-corpus.json`),
  oracle = await read(`${cache}/research/structural-corpus-native.json`),
  reader = await createLatestUnitFormInputs({ profile, image, packageBytes });
check(
  sha(packageBytes) === reference.packageSha256 &&
    reference.packageSha256 === UNIT_FORM_INPUTS_SHA,
  "Unit form input observation/package differs",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native form producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Native form input changed");
for (const b of reference.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Executed form instructions changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new StructuralDecoder(uc, profile, image, constructors),
  e = native.engine,
  base = profile.imageBase,
  counts = {
    nativePacketSamples: 0,
    wasmGetterComparisons: 0,
    replayPackets: 0,
    gameplayRequests: 0,
    snapshotRequests: 0,
    seekQueries: 0,
    boundaryRejections: 0,
  },
  records = [],
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  unhex = (h) => Uint8Array.from(Buffer.from(h, "hex"));
// Register the fragment endpoint before the WASM JIT sees it.
e.hook_add(
  uc.HOOK_CODE,
  () => e.emu_stop(),
  null,
  base + 0xfddf3,
  base + 0xfddf3,
);
function originalGetter(bytes) {
  e.context_restore(native.context);
  e.mem_write(0x10010000, bytes);
  e.reg_write_i64(uc.X86_REG_R14, 0x10010000n);
  e.emu_start(base + 0xfdd9c, base + 0xfddf3, 0, 10000);
  check(
    Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + 0xfddf3,
    "WASM form getter escaped",
  );
  return {
    index: Number(e.reg_read_i64(uc.X86_REG_RSI) & 255n),
    nativeFlag: Boolean(e.reg_read_i64(uc.X86_REG_RCX) & 255n),
  };
}
try {
  for (const p of reference.probes) {
    const o = originalGetter(unhex(p.bytesHex));
    check(
      o.index === p.index && o.nativeFlag === p.nativeFlag,
      "Native/WASM mixed form getter differs",
    );
    counts.wasmGetterComparisons++;
  }
  for (const p of reference.records) {
    const sample = corpus.packets[p.key],
      expected = oracle.observations[p.key],
      observed = native.observePacket(
        129,
        unhex(sample.payloadHex),
        sample.param,
      ),
      decoded = reader.read(observed);
    check(
      observed.complete &&
        observed.consumed === expected.consumed &&
        Buffer.from(observed.object).toString("hex") === expected.object &&
        Buffer.from(observed.heap).toString("hex") === expected.heap &&
        decoded.index === p.index &&
        decoded.signedIndex === p.signedIndex &&
        decoded.nativeFlag === p.nativeFlag &&
        decoded.entityId === p.entityId,
      `Native/WASM packet or form codec differs: ${p.key}`,
    );
    counts.nativePacketSamples++;
  }
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
  let transportSequence = 0;
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const sequence = transportSequence++;
      if (block.opcode !== 129) continue;
      const observation = native.observePacket(129, block.payload, block.param),
        decoded = reader.read(observation),
        original = originalGetter(observation.object);
      check(
        decoded.index === original.index &&
          decoded.nativeFlag === original.nativeFlag,
        "WASM/original full-match form field differs",
      );
      records.push({
        ...decoded,
        time: block.time,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        transportSequence: sequence,
      });
      counts.replayPackets++;
      counts.wasmGetterComparisons++;
      counts[chunk.stream === 1 ? "gameplayRequests" : "snapshotRequests"]++;
    }
  }
  const track = reader.createTrack(records);
  for (const record of records) {
    const earlier = records.filter(
      (p) => p.stream === record.stream && p.entityId === record.entityId,
    );
    for (const time of [
      record.time,
      record.time + 0.0001,
      Math.max(0, record.time - 0.0001),
    ]) {
      const expected =
        earlier
          .filter((p) => p.time <= time)
          .sort(
            (a, b) =>
              b.time - a.time || b.transportSequence - a.transportSequence,
          )[0] ?? null;
      check(
        same(
          track.latestRequest(record.entityId, time, record.stream),
          expected,
        ),
        "Unit form seek differs",
      );
      counts.seekQueries++;
    }
  }
  for (const f of [
    () => reader.createTrack([{ ...records[0], resourceIdentity: 1 }]),
    () => track.latestRequest(records[0].entityId, 0),
    () => reader.read({ complete: true, object: new Uint8Array(20) }),
    () => reader.createTrack([records[0], records[0]]),
  ]) {
    let rejected = false;
    try {
      f();
    } catch {
      rejected = true;
    }
    check(rejected, "Unit form boundary failed to reject an unsupported input");
    counts.boundaryRejections++;
  }
  const heroes = await read(`${cache}/research/latest-semantics-effects.json`),
    byEntity = Object.fromEntries(
      [...new Set(records.map((r) => r.entityId))].map((id) => [
        id,
        {
          champion:
            heroes.heroes.find((h) => h.entityId === id)?.champion ?? null,
          gameplay: records.filter((r) => r.entityId === id && r.stream === 1)
            .length,
          snapshots: records.filter((r) => r.entityId === id && r.stream === 2)
            .length,
          requestedIndices: [
            ...new Set(
              records
                .filter((r) => r.entityId === id)
                .map((r) => r.signedIndex),
            ),
          ].sort((a, b) => a - b),
        },
      ]),
    );
  const bundle = await Bun.build({
    entrypoints: [`${root}/latest-unit-form-inputs.mjs`],
    target: "browser",
    write: false,
  });
  check(bundle.success, "Browser unit form module failed to bundle");
  await Bun.write(
    `${cache}/research/unit-form-inputs-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "unit-form-inputs-native-wasm-comparison",
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "latest-unit-form-inputs.mjs",
              "tools/inspect-unit-form-inputs.mjs",
            ].map(async (p) => [
              p,
              sha(await Bun.file(`${root}/${p}`).bytes()),
            ]),
          ),
        ),
        counts,
        byEntity,
        records,
        mismatchCount: 0,
        scope: {
          browserCompatibleDecoder: true,
          originalGetterExecutedInWasm: true,
          browserBundleBuilt: true,
          browserExecuted: false,
          requestSeekingVerified: true,
          liveFormTablesRecovered: false,
          liveOverlayStateRecovered: false,
          effectFactoryExecuted: false,
          mainViewerExpanded: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ counts, byEntity, mismatchCount: 0 }));
} finally {
  native.close();
}

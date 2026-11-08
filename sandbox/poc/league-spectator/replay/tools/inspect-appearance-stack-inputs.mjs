// Compare original native and WASM appearance getters, then decode the matching
// ROFL through the browser-compatible transport/structural/runtime modules.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import {
  createLatestAppearanceStackInputs,
  APPEARANCE_STACK_INPUTS_SHA,
} from "../latest-appearance-stack-inputs.mjs";

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
  packageBytes = await raw(
    `${assets}/latest-appearance-stack-inputs/package.json`,
  ),
  reference = await read(
    `${cache}/research/appearance-stack-inputs-native.json`,
  ),
  corpus = await read(`${cache}/research/structural-corpus.json`),
  oracle = await read(`${cache}/research/structural-corpus-native.json`),
  reader = await createLatestAppearanceStackInputs({
    profile,
    image,
    packageBytes,
  });
check(
  reference.packageSha256 === APPEARANCE_STACK_INPUTS_SHA,
  "Native appearance package differs",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native appearance source changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Native appearance evidence changed");
for (const b of reference.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original appearance code changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new StructuralDecoder(uc, profile, image, constructors),
  e = native.engine,
  base = profile.imageBase,
  frame = 0x100f5000,
  packet = 0x10200000,
  specs = {
    984: {
      outputs: {
        entryId: "RSI",
        skinId: "RCX",
        alternateSkinA: 8,
        alternateSkinB: 10,
        gearIndex: 6,
        overrideMask: 11,
        flagR8: "R8",
        flagR9: "R9",
        flagStack0: 0,
        preloadFlag: 1,
        flagStack2: 2,
        flagStack3: 3,
      },
    },
    459: { outputs: { entryId: "RSI", popFlagR8: "R8" } },
    1045: { outputs: { clearFlag: "RSI" } },
    965: { outputs: { sourceEntityId: "RSI" } },
  },
  counts = {
    nativePacketSamples: 0,
    wasmGetterComparisons: 0,
    replayPackets: 0,
    gameplayRequests: 0,
    snapshotRequests: 0,
    seekQueries: 0,
    boundaryRejections: 0,
    modifierNames: 0,
  },
  records = [];
// Match the native prefix's routing control and stack. No unit callback runs.
const unitPage = Math.floor(reference.routingUnit / 4096) * 4096;
e.mem_map(unitPage, 4096, uc.PROT_ALL);
e.mem_write(reference.routingUnit, unhex(reference.routingUnitHex));
for (const spec of Object.values(reader.metadata.packets)) {
  const end = base + spec.getterBlock[1];
  e.hook_add(uc.HOOK_CODE, () => e.emu_stop(), null, end, end);
}
function originalGetter(opcode, object) {
  const spec = reader.metadata.packets[opcode],
    [start, end] = spec.getterBlock;
  e.context_restore(native.context);
  e.reg_write_i64(uc.X86_REG_RSP, 0x10010008n);
  e.mem_write(packet, object);
  e.mem_write(frame - 0x100, new Uint8Array(0x100));
  const pointer = new Uint8Array(8);
  new DataView(pointer.buffer).setBigUint64(
    0,
    BigInt(reference.routingUnit),
    true,
  );
  e.mem_write(frame - 0x50, pointer);
  for (const [reg, value] of Object.entries({
    R14: packet,
    RSI: packet,
    RDI: reference.routingUnit,
    RBP: frame,
  }))
    e.reg_write_i64(uc[`X86_REG_${reg}`], BigInt(value));
  e.emu_start(base + start, base + end, 0, 10000);
  check(
    Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + end,
    "WASM appearance getter escaped",
  );
  const rsp = Number(e.reg_read_i64(uc.X86_REG_RSP)),
    result = {};
  for (const [name, output] of Object.entries(specs[opcode].outputs)) {
    const f = spec.fields[name],
      value =
        typeof output === "string"
          ? e.reg_read_i64(uc[`X86_REG_${output}`])
          : new DataView(
              Uint8Array.from(e.mem_read(rsp + output * 8, 8)).buffer,
            ).getBigUint64(0, true);
    result[name] = f.boolean
      ? Boolean(value & 255n)
      : Number(value & ((1n << BigInt(f.width * 8)) - 1n));
  }
  return result;
}
function sameFields(a, b) {
  return Object.entries(b).every(
    ([name, value]) => JSON.stringify(a[name]) === JSON.stringify(value),
  );
}
try {
  for (const p of reference.probes) {
    const spec = reader.metadata.packets[p.opcode],
      f = spec.fields[p.field],
      object = new Uint8Array(spec.objectSize);
    object.set(unhex(p.encodedHex), f.offset);
    const actual = originalGetter(p.opcode, object);
    check(actual[p.field] === p.value, "Native/WASM appearance scalar differs");
    counts.wasmGetterComparisons++;
  }
  for (const p of reference.records) {
    const sample = corpus.packets[p.key],
      expected = oracle.observations[p.key],
      observation = native.observePacket(
        p.opcode,
        unhex(sample.payloadHex),
        sample.param,
      ),
      decoded = reader.read(observation),
      fields = Object.fromEntries(
        Object.keys(reader.metadata.packets[p.opcode].fields).map((name) => [
          name,
          p[name],
        ]),
      );
    if (p.opcode === 984) {
      fields.strings = p.strings;
      fields.modifierNames = p.modifierNames;
    }
    check(
      observation.complete &&
        observation.consumed === expected.consumed &&
        Buffer.from(observation.object).toString("hex") === expected.object &&
        Buffer.from(observation.heap).toString("hex") === expected.heap &&
        decoded.entityId === p.entityId &&
        sameFields(decoded, fields),
      `Native/WASM appearance packet differs: ${p.key}`,
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
  let sequence = 0;
  for (const chunk of replayChunks(replay, decompress)) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const transportSequence = sequence++;
      if (!specs[block.opcode]) continue;
      const observation = native.observePacket(
          block.opcode,
          block.payload,
          block.param,
        ),
        decoded = reader.read(observation),
        original = originalGetter(block.opcode, observation.object);
      check(
        sameFields(decoded, original),
        "Browser/original full-match appearance arguments differ",
      );
      records.push({
        ...decoded,
        time: block.time,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        transportSequence,
      });
      counts.replayPackets++;
      counts.wasmGetterComparisons++;
      counts[chunk.stream === 1 ? "gameplayRequests" : "snapshotRequests"]++;
      counts.modifierNames += decoded.modifierNames?.length ?? 0;
    }
  }
  const track = reader.createTrack(records);
  for (const r of [...records].reverse())
    for (const time of [
      r.time,
      r.time + 0.0001,
      Math.max(0, r.time - 0.0001),
    ]) {
      const expected = records
          .filter(
            (p) =>
              p.stream === r.stream &&
              p.entityId === r.entityId &&
              p.time <= time,
          )
          .sort(
            (a, b) =>
              a.time - b.time || a.transportSequence - b.transportSequence,
          ),
        actual = track.requestsThrough(r.entityId, time, r.stream);
      check(
        JSON.stringify(actual) === JSON.stringify(expected) &&
          Object.isFrozen(actual),
        "Appearance request history seek differs",
      );
      counts.seekQueries++;
    }
  const push = reference.records.find((r) => r.opcode === 984),
    sample = corpus.packets[push.key],
    observed = native.observePacket(
      984,
      unhex(sample.payloadHex),
      sample.param,
    ),
    mutate = (fn) => {
      const object = observed.object.slice(),
        heap = observed.heap.slice();
      fn(object, heap);
      heap.set(object);
      return { complete: true, object, heap };
    };
  for (const fn of [
    () =>
      reader.read({
        complete: false,
        object: observed.object,
        heap: observed.heap,
      }),
    () =>
      reader.read(
        mutate((o) =>
          new DataView(o.buffer).setBigUint64(0x18, 0xffffffffffffffffn, true),
        ),
      ),
    () =>
      reader.read(
        mutate((o) => new DataView(o.buffer).setUint32(0x20, 4097, true)),
      ),
    () =>
      reader.read(
        mutate((o) => new DataView(o.buffer).setUint32(0x30, 257, true)),
      ),
    () =>
      reader.read(
        mutate((o) => {
          const v = new DataView(o.buffer);
          v.setUint32(0x30, 1, true);
          v.setBigUint64(0x28, 0xffffffffffffffffn, true);
        }),
      ),
    () => reader.createTrack([records[0], records[0]]),
    () => reader.createTrack([{ ...records[0], resourceIdentity: 1 }]),
    () => track.requestsThrough(records[0].entityId, 0),
  ]) {
    let rejected = false;
    try {
      fn();
    } catch {
      rejected = true;
    }
    check(rejected, "Appearance input boundary accepted an unsupported input");
    counts.boundaryRejections++;
  }
  const byOpcode = Object.fromEntries(
      Object.keys(specs).map((opcode) => [
        opcode,
        {
          gameplay: records.filter(
            (r) => r.opcode === Number(opcode) && r.stream === 1,
          ).length,
          snapshots: records.filter(
            (r) => r.opcode === Number(opcode) && r.stream === 2,
          ).length,
        },
      ]),
    ),
    bundle = await Bun.build({
      entrypoints: [`${root}/latest-appearance-stack-inputs.mjs`],
      target: "browser",
      write: false,
    });
  check(bundle.success, "Browser appearance input module failed to bundle");
  await Bun.write(
    `${cache}/research/appearance-stack-inputs-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "appearance-stack-inputs-native-wasm-comparison",
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "latest-appearance-stack-inputs.mjs",
              "tools/inspect-appearance-stack-inputs.mjs",
            ].map(async (p) => [
              p,
              sha(await Bun.file(`${root}/${p}`).bytes()),
            ]),
          ),
        ),
        counts,
        byOpcode,
        records,
        mismatchCount: 0,
        scope: {
          browserCompatibleDecoder: true,
          originalGetterExecutedInWasm: true,
          browserBundleBuilt: true,
          browserExecuted: false,
          requestSeekingVerified: true,
          fullAppearanceTransitionExecuted: false,
          liveOverlayStateRecovered: false,
          effectFactoryExecuted: false,
          mainViewerExpanded: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ counts, byOpcode, mismatchCount: 0 }));
} finally {
  native.close();
}

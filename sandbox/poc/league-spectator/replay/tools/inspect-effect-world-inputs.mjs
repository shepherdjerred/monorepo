// Original packet world lookup and descriptor pointer routing in WASM, followed
// by immutable joins to the complete replay request timeline. No live unit claim.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { NativeDecoder } from "../native-decoder.mjs";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
import {
  createLatestEffectWorldInputs,
  EFFECT_WORLD_INPUTS_SHA,
} from "../latest-effect-world-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
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
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  reference = await read(`${cache}/research/effect-world-inputs-native.json`),
  api = await createLatestEffectWorldInputs({
    profile,
    image,
    packageBytes: await raw(
      `${assets}/latest-effect-world-inputs/package.json`,
    ),
  }),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  pipeline = await createLatestEffectPipeline({
    report,
    effectsManifestBytes: await raw(`${assets}/latest-effects/manifest.json`),
    quadGpuBytes: await raw(`${assets}/latest-complete-quad-gpu/package.json`),
    trailGpuBytes: await raw(`${assets}/latest-trail-particles/gpu.json`),
  });
check(
  reference.packageSha256 === EFFECT_WORLD_INPUTS_SHA &&
    reference.counts.pointerPatterns === 11 &&
    reference.counts.pointerFieldsCompared === 44,
  "Complete native entity-routing observation required",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `World-input producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, `World-input source changed: ${path}`);
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  base = profile.imageBase,
  ENTRY = 0x100f1000,
  GROUP = 0x100f2000,
  FRAME = 0x100f5000,
  snapshot = reference.worldSnapshot,
  heap = unhex(snapshot.heapHex),
  counts = {
    pointerPatterns: 0,
    pointerFieldsCompared: 0,
    immutableWorldSnapshots: 0,
    creationJoins: 0,
    entityQueries: 0,
    ownerBindingRejections: 0,
    formerThreeFieldFalseAdmissions: 0,
  };
let active = false,
  endpoint;
try {
  e.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
  e.mem_write(snapshot.heapAddress, heap);
  for (const p of snapshot.imagePatches) {
    check(p.rva >= 0x1fef000, "Entity routing snapshot patches code");
    e.mem_write(base + p.rva, unhex(p.bytesHex));
  }
  e.mem_protect(base + 0x9000, 0x1fef000 - 0x9000, uc.PROT_READ | uc.PROT_EXEC);
  e.hook_add(
    uc.HOOK_BLOCK,
    (_e, address) => {
      const rva = Number(address) - base;
      if (
        !active ||
        !(
          rva === endpoint ||
          [
            [0x84ec42, 0x84ef29],
            [0x548f00, 0x548f50],
            [0x84f02b, 0x84f033],
            [0x84f530, 0x8501af],
          ].some(([a, b]) => rva >= a && rva < b)
        )
      )
        throw Error(
          "Entity routing escaped original lookup/pointer-prefix code",
        );
    },
    null,
    base,
    base + image.length - 1,
  );
  e.hook_add(
    uc.HOOK_MEM_WRITE,
    (_e, _kind, address, size) => {
      const at = Number(address);
      if (
        active &&
        !(
          (at >= FRAME - 0x200 && at + size <= FRAME) ||
          (at >= ENTRY && at + size <= ENTRY + 0xb8) ||
          (at >= 0x201f0000 && at + size <= 0x20200000)
        )
      )
        throw Error("Entity routing mutated its supplied world/library");
    },
    null,
    1,
    0,
  );
  for (const end of [0x84ef29, 0x84f033, 0x8501af])
    e.hook_add(
      uc.HOOK_CODE,
      () => {
        if (endpoint === end) e.emu_stop();
      },
      null,
      base + end,
      base + end,
    );
  function run(start, end, registers) {
    e.context_restore(native.context);
    e.reg_write_i64(uc.X86_REG_RSP, 0x201ff008n);
    for (const [name, value] of Object.entries(registers))
      e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
    active = true;
    endpoint = end;
    try {
      e.emu_start(base + start, base + end, 0, 5000000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + end,
        "Entity routing instruction bound exceeded",
      );
    } finally {
      active = false;
    }
  }
  for (const c of reference.cases) {
    e.mem_write(ENTRY, unhex(c.entryHex));
    e.mem_write(GROUP, unhex(c.groupHex));
    e.mem_write(FRAME - 0x200, new Uint8Array(0x200));
    native.u64(FRAME - 0x38, GROUP);
    native.u64(FRAME - 0x40, ENTRY);
    run(0x84ec42, 0x84ef29, { RBP: FRAME, RBX: ENTRY });
    const reg = (name) => Number(e.reg_read_i64(uc[`X86_REG_${name}`])),
      pointers = {
        resourceContextEntityId: reg("R12"),
        lookup14EntityId: Number(
          new DataView(native.read(FRAME - 0x80, 8).buffer).getBigUint64(
            0,
            true,
          ),
        ),
        attachmentEntityId: Number(
          new DataView(native.read(FRAME - 0x78, 8).buffer).getBigUint64(
            0,
            true,
          ),
        ),
        lookupA8EntityId: reg("R8"),
      };
    check(
      isDeepStrictEqual(pointers, c.pointers),
      "Original native/WASM world lookup pointers differ",
    );
    run(0x84f02b, 0x84f033, {
      RBP: FRAME,
      R8: pointers.lookupA8EntityId,
      R12: pointers.resourceContextEntityId,
    });
    run(0x84f530, 0x8501af, {
      RBP: FRAME,
      RBX: pointers.lookup14EntityId,
      R15: 0,
      R12: 0,
    });
    check(
      Buffer.from(native.read(FRAME - 0x190, 0xc0)).toString("hex") ===
        c.descriptorHex,
      "Original native/WASM descriptor pointer routing differs",
    );
    check(
      isDeepStrictEqual(native.read(snapshot.heapAddress, heap.length), heap),
      "Original world lookup mutated supplied unit state",
    );
    for (const p of snapshot.imagePatches)
      check(
        Buffer.from(native.read(base + p.rva, p.bytesHex.length / 2)).toString(
          "hex",
        ) === p.bytesHex,
        "Original world lookup mutated initialized globals",
      );
    counts.pointerPatterns++;
    counts.pointerFieldsCompared += 4;
    counts.immutableWorldSnapshots++;
  }
} finally {
  native.close();
}
const joined = api.bindTimeline(pipeline);
check(
  isDeepStrictEqual(
    joined.worldInputSummary.nonzeroFields,
    reference.counts.nonzeroFields,
  ),
  "Replay world-input counts differ",
);
check(
  joined.worldInputSummary.requestsWithEntityReferences === 1833 &&
    joined.worldInputSummary.requestsWithoutEntityReferences === 391,
  "Complete replay reference classification differs",
);
for (let index = 0; index < report.effectCreations.length; index++) {
  const original = pipeline.creation(index),
    bound = joined.creation(index),
    { worldInputs, ...rest } = bound;
  check(
    isDeepStrictEqual(original, rest),
    "World inputs changed the canonical creation record",
  );
  check(
    Object.isFrozen(worldInputs.references) &&
      Object.isFrozen(worldInputs.references[0]),
    "Entity input metadata is mutable",
  );
  for (const ref of worldInputs.references)
    check(
      ref.entityId === report.effectDescriptors[index][ref.field],
      "World input dropped a recorded entity ID",
    );
  if (!worldInputs.entityPointerInputsAreNull) {
    let rejected = false;
    try {
      api.requireNullEntityInputs(original);
    } catch (error) {
      rejected = error.message.includes("Live effect entity bindings required");
    }
    check(rejected, "Provider-free factory admitted a nonzero world entity");
    counts.ownerBindingRejections++;
  } else api.requireNullEntityInputs(original);
  if (
    original.descriptor.resourceContextEntityId !== 0 &&
    ["attachmentEntityId", "lookup14EntityId", "lookupA8EntityId"].every(
      (k) => original.descriptor[k] === 0,
    )
  )
    counts.formerThreeFieldFalseAdmissions++;
  counts.creationJoins++;
  for (const time of [
    original.time,
    Math.min(report.endTime, original.time + 0.05),
    Math.max(0, original.time - 0.05),
  ]) {
    const prior = pipeline.sampleEntity(original.entityId, time),
      actual = joined.sampleEntity(original.entityId, time);
    check(
      isDeepStrictEqual(prior?.state, actual?.state),
      "World inputs changed request generation/removal state",
    );
    if (actual?.creation)
      check(
        actual.creation.worldInputs.creationSequence ===
          actual.state.creationSequence,
        "World-input timeline joined another generation",
      );
    counts.entityQueries++;
  }
}
const built = await Bun.build({
  entrypoints: [`${root}/latest-effect-world-inputs.mjs`],
  target: "browser",
  write: false,
});
check(built.success, "World-input browser bundle failed");
const sources = {};
for (const name of [
  "latest-effect-world-inputs.mjs",
  "latest-effect-pipeline.mjs",
  "native-decoder.mjs",
  "tools/inspect-effect-world-inputs.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
await Bun.write(
  `${cache}/research/effect-world-inputs-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "native-wasm-effect-world-input-comparison",
      inputs,
      sources,
      counts,
      mismatchCount: 0,
      summary: joined.worldInputSummary,
      scope: {
        originalLookupsAndPointerRoutingCompared: true,
        suppliedWorldReadOnly: true,
        allReplayCreationInputsJoined: true,
        allFourNonzeroInputRejectionsCompared: true,
        browserBundleBuilt: true,
        liveWorldReconstructed: false,
        liveResourceStacksReconstructed: false,
        factoryExecuted: false,
        browserExecuted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    counts,
    mismatchCount: 0,
    summary: joined.worldInputSummary,
  }),
);

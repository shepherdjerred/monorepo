// The original unit component getter, map lookups and precedence run in WASM.
// Unit stacks are fixture inputs, not recovered replay world state.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (path) => {
    const b = await Bun.file(path).bytes();
    inputs[path] = sha(b);
    return b;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  check = (ok, message) => {
    if (!ok) throw Error(message);
  },
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  reference = await read(`${cache}/research/unit-resources-native.json`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  base = profile.imageBase;
const manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  contexts = await createLatestEffectContexts({
    profile,
    packageBytes: await raw(`${assets}/latest-effect-contexts/package.json`),
    effectsManifestBytes: manifestBytes,
  }),
  resolvers = await createLatestEffectResolvers({
    profile,
    builtinContextPackageBytes: await raw(
      `${assets}/latest-builtin-resource-contexts/package.json`,
    ),
    contexts,
    effectsManifestBytes: manifestBytes,
    packageBytes: await raw(`${assets}/latest-effect-resolvers/package.json`),
  }),
  policy = await createLatestUnitResources({
    profile,
    resolvers,
    packageBytes: await raw(`${assets}/latest-unit-resources/package.json`),
  }),
  handles = new Map(
    reference.maps.map((m) => [
      m.object,
      {
        id: `${m.actorKey}/${m.handle}`,
        contextIdentity: contexts.metadata.contexts.find(
          (c) => c.actorKey === m.actorKey,
        ).identity,
      },
    ]),
  ),
  handleFor = (address) => {
    if (address === 0) return null;
    const h = handles.get(address);
    check(h, "Native unit refers to an unprepared map instance");
    return h;
  },
  suppliedUnits = new Map(
    reference.units.map((u) => [
      u.object,
      {
        status: "supplied-resource-stack",
        base: handleFor(u.baseResolver),
        overlays: u.overlays.map(handleFor),
      },
    ]),
  );
check(
  policy.metadata.observationSha256 ===
    sha(await raw(`${cache}/research/unit-resources-native.json`)),
  "Unit resource policy/native evidence differs",
);
check(
  reference.build === profile.clientVersion &&
    reference.protocol === profile.protocolDigest &&
    reference.decoderImageSha256 === sha(image) &&
    reference.scope.suppliedStacksNotObservedMatchState &&
    reference.scope.originalEntityAndComponentConstructors &&
    reference.scope.originalComponentGetter &&
    !reference.scope.globalResolutionExecuted &&
    !reference.scope.worldEffectFactoryExecuted,
  "Matching scoped unit resource observation required",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Original unit resource producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(
    sha(await raw(path)) === digest,
    "Original unit resource input changed",
  );
for (const block of reference.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Original unit resource instructions changed",
  );
const start = reference.heapStart,
  heap = Uint8Array.from(Buffer.from(reference.heapHex, "hex")),
  page = Math.floor(start / 4096) * 4096,
  end = Math.ceil((start + heap.length) / 4096) * 4096;
check(
  start >= 0x10400000 && end <= 0x12000000,
  "Unit resource snapshot exceeds owned heap",
);
e.mem_map(page, end - page, uc.PROT_ALL);
e.mem_write(start, heap);
e.mem_protect(page, end - page, uc.PROT_READ);
let active = false;
e.hook_add(
  uc.HOOK_CODE,
  () => {
    if (active) e.emu_stop();
  },
  null,
  base + 0x377a2d,
  base + 0x377a2d,
);
e.hook_add(
  uc.HOOK_BLOCK,
  (_e, address) => {
    const at = Number(address) - base;
    check(
      active &&
        [
          [0xd1790, 0xd17a0],
          [0x16153d0, 0x1615440],
          [0x377890, 0x377a2e],
          [0x377b54, 0x377b67],
        ].some(([a, b]) => at >= a && at < b),
      "Unit resource lookup escaped original getter/map/resolver code",
    );
  },
  null,
  base,
  base + image.length - 1,
);
const counts = {
    lookups: 0,
    nullReferenceMatches: 0,
    globalBoundaryStops: 0,
    translatedSelections: 0,
    overlayPushComparisons: 0,
    overlayCapacityControls: 0,
  },
  results = [];
try {
  const [firstHandle, secondHandle] = handles.values();
  check(
    firstHandle && secondHandle,
    "Distinct resource control handles required",
  );
  const full = Array(4096).fill(firstHandle);
  for (const next of [secondHandle, null]) {
    let rejected = false;
    try {
      policy.pushOverlay(full, next);
    } catch (error) {
      if (error.message !== "Resource overlay vector exceeds its bound")
        throw error;
      rejected = true;
    }
    check(
      rejected && full.length === 4096 && full.every((h) => h === firstHandle),
      "Overlay capacity failure mutated its input or returned an invalid vector",
    );
    counts.overlayCapacityControls++;
  }
  const reordered = policy.pushOverlay(full, firstHandle);
  check(
    reordered.length === 4096 && Object.isFrozen(reordered),
    "A full overlay vector must still permit moving an existing identity",
  );
  counts.overlayCapacityControls++;
  for (const unit of reference.units.filter((u) => u.label === "overlay")) {
    const a = handleFor(unit.baseResolver),
      b = handles.get(
        reference.maps.find(
          (m) => m.actorKey === unit.actorKey && m.handle === "B",
        ).object,
      );
    let overlays = [];
    for (const h of [b, null, a, b]) overlays = policy.pushOverlay(overlays, h);
    check(
      JSON.stringify(overlays) ===
        JSON.stringify(suppliedUnits.get(unit.object).overlays),
      "JS/original overlay identity reordering differs",
    );
    counts.overlayPushComparisons++;
  }
  for (const c of reference.cases) {
    const translated = policy.selectSuppliedStacks(
      {
        units: c.units.map((u) => suppliedUnits.get(u)),
        auxiliaries: c.auxiliaries.map(handleFor),
      },
      c.key,
    );
    check(
      translated.status === c.status,
      "JS/original unit selection state differs",
    );
    if (c.status === "matched-authored-reference") {
      check(
        translated.referenceToken === c.value &&
          translated.handleId === handleFor(c.owner).id,
        "JS/original unit resource handle/reference differs",
      );
      const expectedStage = {
        "first-unit-base": { kind: "unit-base", unitIndex: 0 },
        "newest-overlay": {
          kind: "unit-overlay",
          unitIndex: 0,
          overlayIndex: 2,
        },
        "unit-before-auxiliary": { kind: "unit-base", unitIndex: 1 },
        "auxiliary-after-unit-miss": { kind: "auxiliary", index: 0 },
        "skip-null-overlay": { kind: "unit-base", unitIndex: 0 },
      }[c.label];
      check(
        JSON.stringify(translated.stage) === JSON.stringify(expectedStage),
        "JS chose the right handle at the wrong precedence stage",
      );
    }
    counts.translatedSelections++;
    e.context_restore(native.context);
    e.mem_write(0x100e9000, new Uint8Array(0x40));
    for (const [vector, array, objects] of [
      [0x100e9000, 0x100e9800, c.units],
      [0x100e9020, 0x100ea000, c.auxiliaries],
    ]) {
      for (const [i, obj] of objects.entries()) native.u64(array + i * 8, obj);
      native.u64(vector, array);
      native.u64(vector + 8, array + objects.length * 8);
      native.u64(vector + 16, array + objects.length * 8);
    }
    native.u64(0x100eb000, 0);
    for (const [reg, value] of Object.entries({
      RDI: c.key,
      RSI: 0x100e9000,
      RDX: 0x100e9020,
      RCX: 0,
      R8: 0x100eb000,
    }))
      e.reg_write_i64(uc[`X86_REG_${reg}`], BigInt(value));
    active = true;
    if (c.status === "continue-global-resolution") {
      const stack = NativeDecoder.STACK + 0x200000 - 0x1000 + 8;
      native.u64(stack, 0x10009000);
      e.reg_write_i64(uc.X86_REG_RSP, BigInt(stack));
      e.emu_start(base + 0x377890, base + 0x377a2d, 0, 100000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + 0x377a2d,
        "Unit miss did not reach global boundary",
      );
      counts.globalBoundaryStops++;
    } else {
      native.call(base + 0x377890);
      const value = Number(e.reg_read_i64(uc.X86_REG_RAX)),
        owner = Number(
          new DataView(native.read(0x100eb000, 8).buffer).getBigUint64(0, true),
        );
      check(
        value === c.value && owner === c.owner,
        "Native/WASM unit resource owner/reference differs",
      );
      if (value === 0) counts.nullReferenceMatches++;
    }
    active = false;
    counts.lookups++;
    results.push({
      actorKey: c.actorKey,
      label: c.label,
      key: c.key,
      status: c.status,
      value: c.value,
      owner: c.owner,
    });
  }
  check(
    sha(native.read(start, heap.length)) === sha(heap),
    "Original unit lookup mutated the resource world",
  );
} finally {
  native.close();
}
const sources = {};
const browserBundle = await Bun.build({
  entrypoints: [`${root}/latest-unit-resources.mjs`],
  target: "browser",
  write: false,
});
check(browserBundle.success, "Unit resource policy browser bundle failed");
for (const name of [
  "tools/inspect-unit-resources.mjs",
  "native-decoder.mjs",
  "tools/prepare-unit-resources.mjs",
  "latest-unit-resources.mjs",
  "latest-effect-contexts.mjs",
  "latest-effect-resolvers.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-unit-resource-precedence-comparison",
  inputs,
  sources,
  counts,
  results,
  mismatchCount: 0,
  scope: {
    originalGetterAndResolverExecuted: true,
    translatedSuppliedStackPolicyCompared: true,
    browserBundleBuilt: true,
    originalConstructionComparedViaNativeSnapshot: true,
    suppliedStacksNotObservedMatchState: true,
    immutableWorldSnapshot: true,
    globalResolutionExecuted: false,
    worldEffectFactoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/unit-resources-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));

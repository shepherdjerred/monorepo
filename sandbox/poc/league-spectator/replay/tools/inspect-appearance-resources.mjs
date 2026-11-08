// Original native/WASM projection and original base-context callback comparison.
// Explicit prepared inputs; no live unit appearance or cache readiness inferred.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestAppearanceResources,
  APPEARANCE_RESOURCES_SHA,
} from "../latest-appearance-resources.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const bytes = await Bun.file(p).bytes();
    inputs[p] = sha(bytes);
    return bytes;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (value, message) => {
    if (!value) throw Error(message);
  },
  unhex = (h) => Uint8Array.from(Buffer.from(h, "hex")),
  assets = `${cache}/public`,
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  constructors = await raw(`${assets}/decoder-16.21-macos/constructors.bin`),
  packageBytes = await raw(
    `${assets}/latest-appearance-resources/package.json`,
  ),
  reference = await read(`${cache}/research/appearance-resources-native.json`),
  reader = await createLatestAppearanceResources({
    profile,
    image,
    packageBytes,
  });
check(
  reference.packageSha256 === APPEARANCE_RESOURCES_SHA,
  "Native appearance projection package differs",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native appearance projection source changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(
    sha(await raw(path)) === digest,
    "Native appearance projection input changed",
  );
for (const block of reference.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Executed appearance resource instructions changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new StructuralDecoder(uc, profile, image, constructors),
  e = native.engine,
  snapshot = reference.snapshot,
  heap = unhex(snapshot.heapHex),
  heapPageSize = Math.ceil(heap.length / 4096) * 4096,
  base = profile.imageBase,
  out = 0x100e8000,
  rsp = 0x201ff008,
  stop = 0x10009000,
  q = (at) =>
    new DataView(Uint8Array.from(e.mem_read(at, 8)).buffer).getBigUint64(
      0,
      true,
    ),
  word = (at) =>
    new DataView(Uint8Array.from(e.mem_read(at, 4)).buffer).getUint32(0, true),
  byte = (at) => e.mem_read(at, 1)[0],
  preparedCache = reference.preparedCache.map((c) => ({
    handleId: String(c.object),
    key: Object.fromEntries(
      ["name", "namespace", "skinId", "keyFlags"].map((k) => [k, c[k]]),
    ),
    contextIdentity: c.context ? reference.contexts[c.context].identity : null,
  })),
  counts = {
    projectionControls: 0,
    channelsCompared: 0,
    baseContextCallbacks: 0,
    cacheMissStops: 0,
    boundaryRejections: 0,
    immutableInputs: 0,
  },
  selectedExamples = [];
e.mem_map(snapshot.heapAddress, heapPageSize, uc.PROT_ALL);
e.mem_write(snapshot.heapAddress, heap);
for (const patch of snapshot.imagePatches) {
  check(patch.rva >= 0x1fef000, "Appearance snapshot patches original code");
  e.mem_write(base + patch.rva, unhex(patch.bytesHex));
}
check(
  q(base + snapshot.localPlayerRva) === 0n,
  "Absent local player input required",
);
let checking = false,
  callback = false;
e.hook_add(uc.HOOK_MEM_WRITE, (_engine, _type, address, size) => {
  if (!checking) return;
  const at = Number(address),
    inside = (start, length) => at >= start && at + size <= start + length;
  if (
    inside(0x20000000, 0x200000) ||
    inside(out, 0x70) ||
    reference.preparedCache.some((c) => inside(c.object + 0x168, 4)) ||
    (callback &&
      (inside(reference.unit.object + 0x110, 8) ||
        inside(reference.unit.group + 0x10, 8)))
  )
    return;
  throw Error(
    `Appearance projection escaped declared writes: ${at.toString(16)} + ${size}`,
  );
});
for (const endpoint of [stop, base + 0x2a91af])
  e.hook_add(uc.HOOK_CODE, () => e.emu_stop(), null, endpoint, endpoint);
function project(stack, missing = false) {
  e.context_restore(native.context);
  e.mem_write(out, new Uint8Array(0x70));
  for (const [i, offset] of [0x28, 0x40, 0x50].entries())
    native.u64(rsp + 8 + i * 8, out + offset);
  for (const [reg, value] of Object.entries({
    RDI: stack,
    RSI: out,
    RDX: out + 8,
    RCX: out + 0x10,
    R8: out + 0x18,
    R9: out + 0x20,
  }))
    e.reg_write_i64(uc[`X86_REG_${reg}`], BigInt(value));
  checking = true;
  try {
    if (missing) {
      native.u64(rsp, stop);
      e.reg_write_i64(uc.X86_REG_RSP, BigInt(rsp));
      e.emu_start(base + 0x67330, base + 0x2a91af, 0, 1000000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + 0x2a91af,
        "Appearance cache miss did not stop before native loading",
      );
      return null;
    }
    native.call(base + 0x67330);
  } finally {
    checking = false;
  }
  return {
    objects: Array.from({ length: 6 }, (_, i) => Number(q(out + i * 8))),
    gearIndex: byte(out + 0x40),
    modifierCount: word(out + 0x58),
  };
}
try {
  for (const c of reference.cases) {
    const original = project(c.stack),
      supplied = { stack: c.input, preparedCache },
      before = JSON.stringify(supplied),
      translated = reader.projectSuppliedStack(supplied),
      ids = reader.metadata.channels.map(
        (channel) => translated.channels[channel]?.handleId ?? null,
      );
    check(
      JSON.stringify(original.objects) ===
        JSON.stringify(c.projection.objects) &&
        original.gearIndex === c.projection.gearIndex &&
        original.modifierCount === c.projection.modifierCount,
      "Native/WASM original appearance projection differs",
    );
    check(
      JSON.stringify(ids) ===
        JSON.stringify(
          original.objects.map((value) => (value ? String(value) : null)),
        ) &&
        translated.gearIndex === original.gearIndex &&
        translated.modifierNames.length === original.modifierCount &&
        Object.isFrozen(translated),
      "Browser/original supplied appearance selection differs",
    );
    check(
      JSON.stringify(supplied) === before,
      "Supplied appearance projection mutated its inputs",
    );
    counts.projectionControls++;
    counts.channelsCompared += 6;
    counts.immutableInputs++;
    if (c.callback) {
      e.context_restore(native.context);
      e.reg_write_i64(uc.X86_REG_RDI, BigInt(reference.unit.object + 0xb28));
      e.reg_write_i64(uc.X86_REG_RSI, BigInt(out + 0x28));
      checking = true;
      callback = true;
      try {
        native.call(base + 0xc4f10);
      } finally {
        checking = false;
        callback = false;
      }
      check(
        Number(q(reference.unit.object + 0x110)) === c.callback.context &&
          Number(q(reference.unit.group + 0x10)) === c.callback.baseResolver,
        "Native/WASM original appearance base-context callback differs",
      );
      counts.baseContextCallbacks++;
    }
    if (
      c.label === "independent-replay-push-control" &&
      c.event.entityId === 1073741887 &&
      selectedExamples.length < 3
    )
      selectedExamples.push({
        time: c.event.time,
        entityId: c.event.entityId,
        input: c.input,
        selected: translated,
      });
  }
  for (const c of reference.boundaryCases) {
    project(c.result.stack, true);
    counts.cacheMissStops++;
    let rejected = false;
    try {
      reader.projectSuppliedStack({ stack: c.input, preparedCache });
    } catch {
      rejected = true;
    }
    check(rejected, "Unprepared appearance cache key silently fell through");
    counts.boundaryRejections++;
  }
  const input = reference.cases[0].input;
  for (const mutate of [
    (value) => (value.stack.localPlayer = "present"),
    (value) => (value.stack.defaultEntry.modifierNames = ["unknown-modifier"]),
    (value) => (value.stack.defaultEntry.alternateCharacterA = "unknown-form"),
    (value) => value.stack.defaultEntry.flags.pop(),
    (value) => value.preparedCache.push(value.preparedCache[0]),
    (value) =>
      value.preparedCache.push({
        ...value.preparedCache[0],
        handleId: "unique-case-alias",
        key: {
          ...value.preparedCache[0].key,
          name: value.preparedCache[0].key.name.toUpperCase(),
        },
      }),
  ]) {
    const supplied = structuredClone({ stack: input, preparedCache });
    mutate(supplied);
    let rejected = false;
    try {
      reader.projectSuppliedStack(supplied);
    } catch {
      rejected = true;
    }
    check(rejected, "Unsupported appearance projection boundary accepted");
    counts.boundaryRejections++;
  }
  const bundle = await Bun.build({
    entrypoints: [`${root}/latest-appearance-resources.mjs`],
    target: "browser",
    write: false,
  });
  check(bundle.success, "Browser appearance resource module failed to bundle");
  await Bun.write(
    `${cache}/research/appearance-resources-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "appearance-resources-native-wasm-comparison",
        inputs,
        sources: Object.fromEntries(
          await Promise.all(
            [
              "latest-appearance-resources.mjs",
              "tools/inspect-appearance-resources.mjs",
            ].map(async (p) => [
              p,
              sha(await Bun.file(`${root}/${p}`).bytes()),
            ]),
          ),
        ),
        counts,
        selectedExamples,
        mismatchCount: 0,
        scope: {
          browserBundleBuilt: true,
          browserExecuted: false,
          fullOriginalProjectionExecutedInWasm: true,
          originalBaseContextCallbackExecutedInWasm: true,
          suppliedPreparedCache: true,
          suppliedNamedResourceLibrary: true,
          suppliedLibraryReadyPredicate: true,
          localPlayerExplicitlyAbsent: true,
          alternateCharactersExplicitlyEmpty: true,
          modifierNamesExplicitlyEmpty: true,
          liveAppearanceStateRecovered: false,
          cacheReadinessRecovered: false,
          allUnitCallbacksExecuted: false,
          referenceLinksFixed: false,
          effectFactoryExecuted: false,
          mainViewerExpanded: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ counts, mismatchCount: 0 }));
} finally {
  native.close();
}

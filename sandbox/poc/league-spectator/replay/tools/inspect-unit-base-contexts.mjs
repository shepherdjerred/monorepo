// Original named lookup/cast/store and unit setter in WASM. Library, readiness
// and resource path are supplied inputs; this does not reconstruct live heroes.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
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
  reference = await read(`${cache}/research/unit-base-contexts-native.json`);
check(
  reference.build === profile.clientVersion &&
    reference.protocol === profile.protocolDigest &&
    reference.decoderImageSha256 === sha(image) &&
    reference.scope.suppliedTypedAssetLibrary &&
    !reference.scope.liveUnitBaseContextRecovered &&
    !reference.scope.effectFactoryExecuted,
  "Matching scoped native base-context observations required",
);
for (const [name, digest] of Object.entries(reference.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Base-context native producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(reference.inputs))
  check(sha(await raw(path)) === digest, "Base-context native input changed");
for (const b of reference.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Executed base-context instructions changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await factory(),
  native = new NativeDecoder(uc, profile, image, { captureWrites: false }),
  e = native.engine,
  base = profile.imageBase,
  FRAME = 0x100f5000,
  PATH = 0x100e0000,
  snapshot = reference.snapshot,
  heap = unhex(snapshot.heapHex),
  counts = {
    namedResourceAcquisitions: 0,
    baseInstallations: 0,
    nullContextPreservations: 0,
    globalBoundaryStops: 0,
    wrongTypeRejections: 0,
    nonnullNullResolverClears: 0,
    baseRestores: 0,
    tlsLookups: 0,
  },
  q = (at) =>
    Number(new DataView(native.read(at, 8).buffer).getBigUint64(0, true)),
  reg = (name, value) => e.reg_write_i64(uc[`X86_REG_${name}`], BigInt(value));
let active = false,
  endpoint = null,
  allowed = [];
e.mem_map(0x10400000, 0x1c00000, uc.PROT_ALL);
e.mem_write(snapshot.heapAddress, heap);
for (const patch of snapshot.imagePatches) {
  check(
    patch.rva >= 0x1fef000,
    "Base-context snapshot attempts to replace code",
  );
  e.mem_write(base + patch.rva, unhex(patch.bytesHex));
}
e.mem_protect(base + 0x9000, 0x1fef000 - 0x9000, uc.PROT_READ | uc.PROT_EXEC);
native.u64(snapshot.tlsCell, reference.library.object);
e.mem_write(0x10028000, new Uint8Array([0xc3]));
e.hook_add(
  uc.HOOK_CODE,
  () => {
    check(
      active &&
        Number(e.reg_read_i64(uc.X86_REG_RDI)) ===
          base + snapshot.tlsDescriptorRva,
      "Unexpected base-context TLS service",
    );
    reg("RAX", snapshot.tlsCell);
    counts.tlsLookups++;
  },
  null,
  0x10028000,
  0x10028000,
);
for (const end of [0x352767, 0x14b7a15])
  e.hook_add(
    uc.HOOK_CODE,
    () => {
      if (endpoint === end) e.emu_stop();
    },
    null,
    base + end,
    base + end,
  );
e.hook_add(
  uc.HOOK_MEM_WRITE,
  (_e, _kind, address, size) => {
    const at = Number(address);
    if (active)
      check(
        [
          [NativeDecoder.STACK, NativeDecoder.STACK + 0x200000],
          [FRAME - 0x500, FRAME],
          ...allowed,
        ].some(([a, b]) => at >= a && at + size <= b),
        "Original base-context execution wrote outside admitted state",
      );
  },
  null,
  0x10000000,
  0x121fffff,
);
function run(start, end, registers, writes = []) {
  e.context_restore(native.context);
  const stack = NativeDecoder.STACK + 0x200000 - 0x1000 + 8;
  native.u64(stack, 0x10009000);
  reg("RSP", stack);
  for (const [name, value] of Object.entries(registers)) reg(name, value);
  active = true;
  endpoint = end;
  allowed = writes;
  try {
    if (end === null) native.call(base + start);
    else {
      e.emu_start(base + start, base + end, 0, 1000000);
      check(
        Number(e.reg_read_i64(uc.X86_REG_RIP)) === base + end,
        "Base-context fragment escaped",
      );
    }
  } finally {
    active = false;
    endpoint = null;
    allowed = [];
  }
}
function acquire(context, path, expected) {
  const text = new TextEncoder().encode(path + "\0");
  check(text.length <= 1024, "Base-context path exceeds native input bound");
  e.mem_write(PATH, text);
  e.mem_write(FRAME - 0x500, new Uint8Array(0x500));
  native.u64(FRAME - 0x378, PATH);
  native.u64(context + 0x60, 0xdeadbeef);
  e.mem_write(context + 0x68, new Uint8Array([0]));
  run(0x3526ff, 0x352767, { RBP: FRAME, RBX: context, R14: context + 0x50 }, [
    [context + 0x60, context + 0x69],
  ]);
  check(
    native.readU32(FRAME - 0x3e8) === expected.identity &&
      q(context + 0x60) === expected.resolver &&
      native.read(context + 0x68, 1)[0] === 1,
    "Native/WASM context lookup/hash/cast/store differs",
  );
}
function install(unit, group, context, expected) {
  run(0x548bf0, null, { RDI: unit, RSI: context }, [
    [unit + 0x110, unit + 0x118],
    [group + 0x10, group + 0x18],
  ]);
  const overlays = [];
  for (let at = q(group + 0x18); at < q(group + 0x20); at += 8)
    overlays.push(q(at));
  check(
    q(unit + 0x110) === expected.context &&
      q(group + 0x10) === expected.baseResolver &&
      JSON.stringify(overlays) === JSON.stringify(expected.overlays),
    "Native/WASM unit context setter differs",
  );
}
try {
  for (const c of reference.cases) {
    acquire(c.context.object, c.resourcePath, c.acquired);
    counts.namedResourceAcquisitions++;
    native.u64(c.unit.group + 0x10, 0xdeadbeef);
    install(c.unit.object, c.unit.group, c.context.object, c.installed);
    counts.baseInstallations++;
    install(c.unit.object, c.unit.group, 0, c.nullContext);
    counts.nullContextPreservations++;
  }
  for (const c of reference.missing) {
    const key = new Uint8Array(4);
    new DataView(key.buffer).setUint32(0, c.resourceIdentity, true);
    e.mem_write(0x100eb800, key);
    run(0x14b7950, 0x14b7a15, { RDI: 0, RSI: 0x100eb800, RDX: 0 });
    counts.globalBoundaryStops++;
  }
  const control = reference.controls,
    first = reference.cases[0];
  native.u64(snapshot.tlsCell, control.wrongTypedLibrary.object);
  acquire(
    control.wrongContext.object,
    first.resourcePath,
    control.wrongAcquired,
  );
  counts.wrongTypeRejections++;
  install(
    first.unit.object,
    first.unit.group,
    control.wrongContext.object,
    control.cleared,
  );
  counts.nonnullNullResolverClears++;
  install(
    first.unit.object,
    first.unit.group,
    first.context.object,
    control.restored,
  );
  counts.baseRestores++;
  check(counts.tlsLookups === 19, "Unexpected base-context asset lookup count");
  await Bun.write(
    `${cache}/research/unit-base-contexts-comparison.json`,
    JSON.stringify(
      {
        schema: 1,
        kind: "unit-base-contexts-native-wasm-comparison",
        inputs,
        sources: {
          "tools/inspect-unit-base-contexts.mjs": sha(
            await Bun.file(import.meta.path).bytes(),
          ),
        },
        counts,
        mismatchCount: 0,
        scope: {
          originalLookupCastStoreExecutedInWasm: true,
          originalUnitSetterExecutedInWasm: true,
          writesBoundedToDeclaredState: true,
          suppliedTypedAssetLibrary: true,
          suppliedPathFormattingResult: true,
          suppliedLibraryReadyPredicate: true,
          fullCharacterLoaderExecuted: false,
          liveUnitBaseContextRecovered: false,
          liveOverlayStateRecovered: false,
          referenceLinksFixed: false,
          effectFactoryExecuted: false,
          mainViewerExpanded: false,
          browserExecuted: false,
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

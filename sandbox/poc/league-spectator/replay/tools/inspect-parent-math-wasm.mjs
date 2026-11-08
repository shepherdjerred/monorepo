// Compare the exact prepared native math corpus with the pinned WASM emulator.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import {
  loadParentMath,
  installParentMath,
  PARENT_MATH_SHA,
} from "../latest-parent-math.mjs";
import { fusedFloatBits } from "../latest-fused-math.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`;
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const inputs = {};
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const math = await loadParentMath(
  await raw(`${assets}/latest-parent-math/package.json`),
  (file) => raw(`${assets}/latest-parent-math/${file}`),
);
const fusedBytes = await raw(
  `${cache}/research/parent-math-fma-reference.json`,
);
if (sha(fusedBytes) !== math.catalog.fmaReferenceSha256)
  throw Error("Fused native corpus changed");
const fused = JSON.parse(new TextDecoder().decode(fusedBytes));
for (const c of fused.cases)
  if (
    fusedFloatBits(BigInt(c.a), BigInt(c.b), BigInt(c.c), c.width) !==
    BigInt(c.expected)
  )
    throw Error("Native fused arithmetic differs");
const runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkBytes));
const wasm = await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  );
const uc = await createLatestBulkUnicorn(
    factory,
    runtimeBytes,
    bulkBytes,
    wasm,
  ),
  engine = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64);
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => Uint8Array.from(s.match(/../g), (v) => parseInt(v, 16));
const began = performance.now();
let isa;
try {
  ({ isa } = installParentMath(uc, engine, math));
  engine.mem_map(0x31000000, 0x10000, uc.PROT_ALL);
  const context = engine.context_alloc();
  engine.context_save(context);
  try {
    for (const s of math.catalog.samples) {
      engine.context_restore(context);
      engine.mem_write(0x3100ff08, new Uint8Array([0, 0, 0, 0x31, 0, 0, 0, 0]));
      engine.mem_write(0x31001000, new Uint8Array(4).fill(0xa5));
      engine.reg_write_i64(uc.X86_REG_RSP, 0x3100ff08n);
      engine.reg_write_i64(uc.X86_REG_RDI, 0x31001000n);
      const x = new Uint8Array(16),
        y = new Uint8Array(16);
      x.set(fromHex(s.xBits));
      y.set(fromHex(s.yBits));
      engine.reg_write(uc.X86_REG_XMM0, x);
      engine.reg_write(uc.X86_REG_XMM1, y);
      const entry = math.catalog.trampolines.entries[s.name];
      engine.emu_start(
        math.catalog.trampolines.base + entry.offset,
        0x31000000,
        0,
        100000,
      );
      const actual = hex(
        engine.reg_read(uc.X86_REG_XMM0, 16).slice(0, entry.resultWidth * 4),
      );
      if (
        engine.reg_read_i64(uc.X86_REG_RIP) !== 0x31000000n ||
        engine.reg_read_i64(uc.X86_REG_RSP) !== 0x3100ff10n ||
        actual !== s.expectedHex ||
        (s.integerHex !== null &&
          hex(engine.mem_read(0x31001000, 4)) !== s.integerHex)
      )
        throw Error(
          `Native/WASM math differs: ${JSON.stringify({ sample: s, actual })}`,
        );
    }
  } finally {
    engine.context_free(context);
  }
} finally {
  engine.close();
}
const sources = {};
for (const name of [
  "latest-parent-math.mjs",
  "latest-math-isa.mjs",
  "latest-fused-math.mjs",
  "latest-unicorn-bulk.mjs",
  "tools/inspect-parent-math-wasm.mjs",
])
  sources[name] = sha(await raw(resolve(import.meta.dir, "..", name)));
const result = {
  schema: 1,
  kind: "parent-math-native-wasm-comparison",
  mathPackageSha256: PARENT_MATH_SHA,
  inputs,
  sources,
  counts: {
    nativeMathSamples: math.catalog.samples.length,
    nativeFusedSamples: fused.cases.length,
    isaInstructions: isa.count,
  },
  mismatchCount: 0,
  elapsedMs: performance.now() - began,
  scope: {
    browserExecuted: false,
    completeFloatDomain: false,
    originalMacosLibmVerified: false,
  },
};
await Bun.write(
  `${cache}/research/parent-math-wasm.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts: result.counts,
    mismatchCount: 0,
    elapsedMs: result.elapsedMs,
  }),
);

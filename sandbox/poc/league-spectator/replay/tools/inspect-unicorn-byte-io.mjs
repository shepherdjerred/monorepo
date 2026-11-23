import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createUnicornByteIo } from "./unicorn-byte-io.mjs";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [runtimePath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: inspect-unicorn-byte-io.mjs <pinned-runtime.mjs> <output.json>",
  );
const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const before = await captureResearchSourceClosure([new URL(import.meta.url)]);
const runtimeBytes = await Bun.file(runtimePath).bytes();
const manifest = await Bun.file(runtimePath.replace(/\.mjs$/, ".json")).json();
if (hash(runtimeBytes) !== manifest.sha256)
  throw Error("Original pinned Unicorn runtime differs");
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const uc = await createUnicorn(),
  original = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64),
  candidate = new uc.Unicorn(uc.ARCH_X86, uc.MODE_64),
  base = 0x10000000,
  bytes = 0x400000;
original.mem_map(base, bytes, uc.PROT_ALL);
candidate.mem_map(base, bytes, uc.PROT_ALL);
const fast = createUnicornByteIo(uc, candidate),
  lengths = [
    0, 1, 2, 3, 4, 7, 8, 11, 15, 63, 64, 65, 4096, 65535, 65536, 1048577,
    2097152, 2097169,
  ];
let comparisons = 0;
function equal(a, b, context) {
  if (!isDeepStrictEqual(a, b))
    throw Error("Native byte IO differs: " + context);
  comparisons++;
}
const rows = [];
try {
  for (const size of lengths) {
    const backing = new Uint8Array(size + 1);
    for (let i = 0; i < size; i++) backing[i + 1] = (i * 17 + size * 3) & 255;
    const input = backing.subarray(1),
      address = base + 37;
    original.mem_write(address, input);
    fast.write(address, input);
    equal(
      new Uint8Array(original.mem_read(address, size)),
      fast.read(address, size),
      "unaligned/offset " + size,
    );
  }
  for (const value of [0n, 1n, -1n, 0x8000000000000000n, 0xffffffffffffffffn]) {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, value, true);
    original.mem_write(base + 1, data);
    fast.writeU64(base + 1, value);
    equal(
      new Uint8Array(original.mem_read(base + 1, 8)),
      fast.read(base + 1, 8),
      "u64 " + value,
    );
    equal(
      new DataView(data.buffer).getUint32(0, true),
      fast.readU32(base + 1),
      "unaligned u32",
    );
  }
  for (const operation of ["read", "write"]) {
    let oldError, newError;
    const at = base + bytes - 8,
      data = new Uint8Array(16).fill(203);
    try {
      operation === "read"
        ? original.mem_read(at, 16)
        : original.mem_write(at, data);
    } catch (e) {
      oldError = String(e);
    }
    try {
      operation === "read" ? fast.read(at, 16) : fast.write(at, data);
    } catch (e) {
      newError = e.code;
    }
    if (!oldError || !Number.isInteger(newError))
      throw Error("Native invalid-range boundary did not reject");
    equal(
      new Uint8Array(original.mem_read(at, 8)),
      fast.read(at, 8),
      "partial error ownership",
    );
    rows.push({ operation, originalError: oldError, nativeCode: newError });
  }
  const input = new Uint8Array(4096).fill(172),
    rounds = 200;
  for (const [name, write, read] of [
    [
      "original",
      original.mem_write.bind(original),
      original.mem_read.bind(original),
    ],
    ["word-packed", fast.write, fast.read],
  ]) {
    const started = performance.now();
    for (let i = 0; i < rounds; i++) {
      write(base, input);
      const result = read(base, input.length);
      if (result[37] !== 172) throw Error("Native benchmark bytes differ");
    }
    rows.push({
      name,
      rounds,
      bytesPerRound: input.length,
      elapsedMs: performance.now() - started,
    });
  }
  fast.close();
  let closedRejected = false;
  try {
    fast.read(base, 1);
  } catch {
    closedRejected = true;
  }
  if (!closedRejected) throw Error("Closed byte owner remained active");
  const after = await captureResearchSourceClosure([new URL(import.meta.url)]);
  equal(before, after, "source closure");
  await Bun.write(
    output,
    JSON.stringify(
      {
        scope:
          "Pinned-runtime native memory ABI/byte ownership component control; no decoder integration or whole-browser speed claim",
        runtimeSha256: hash(runtimeBytes),
        comparisons,
        lengths,
        rows,
        closedRejected,
        sourceBefore: before,
        sourceAfter: after,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, comparisons, rows }));
} finally {
  fast.close();
  original.close();
  candidate.close();
}

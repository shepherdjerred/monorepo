// Compare the real native memory API through the original and bulk wrappers.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-unicorn-bulk.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  packageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  wasmBytes = await raw(`${assets}/latest-unicorn-bulk/${meta.file}`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  );
let memory;
const observeFactory = (options) =>
    factory({
      ...options,
      instantiateWasm(imports, receive) {
        return options.instantiateWasm(imports, (instance, module) => {
          memory = instance.exports[meta.memoryExport];
          receive(instance, module);
        });
      },
    }),
  original = await factory(),
  bulk = await createLatestBulkUnicorn(
    observeFactory,
    runtimeBytes,
    packageBytes,
    wasmBytes,
  ),
  engines = [
    new original.Unicorn(original.ARCH_X86, original.MODE_64),
    new bulk.Unicorn(bulk.ARCH_X86, bulk.MODE_64),
  ],
  data = Uint8Array.from({ length: 4096 }, (_, i) => (i * 73 + 19) & 255),
  observations = [];
const outcome = (engine, address, size) => {
  try {
    return {
      bytesHex: Buffer.from(engine.mem_read(address, size)).toString("hex"),
    };
  } catch (e) {
    return { error: String(e).replace(/^Error: /, "") };
  }
};
try {
  for (const e of engines) {
    e.mem_map(0x10000, 4096, original.PROT_READ | original.PROT_WRITE);
    e.mem_write(0x10000, data);
  }
  for (const [address, size] of [
    [0x10000, 0],
    ...[1, 2, 7, 8, 15, 16, 31, 32, 255, 1024, 4096].map((n) => [0x10000, n]),
    [0x1007b, 113],
    [0x10ff0, 16],
    [0x10ff0, 32],
    [0x11000, 1],
    [0x12000, 8],
  ]) {
    const expected = outcome(engines[0], address, size),
      actual = outcome(engines[1], address, size);
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw Error(`Bulk memory result/error differs at ${address}/${size}`);
    observations.push({ address, size, ...actual });
  }
  const retained = engines[1].mem_read(0x10000, 4096);
  engines[1].mem_write(0x10000, new Uint8Array(4096));
  if (sha(retained) !== sha(data))
    throw Error("Bulk read aliases a freed/reused temporary buffer");
  engines[1].mem_write(0x10000, data);
  const before = memory.buffer.byteLength,
    pointer = bulk._malloc(before + 65536);
  if (!pointer || memory.buffer.byteLength <= before)
    throw Error("Allocator did not exercise actual WASM memory growth");
  const after = memory.buffer.byteLength;
  if (sha(engines[1].mem_read(0x10000, 4096)) !== sha(data))
    throw Error("Bulk memory read failed after native heap growth");
  bulk._free(pointer);
  const corrupt = wasmBytes.slice();
  corrupt[8] ^= 1;
  let rejected = false;
  try {
    await createLatestBulkUnicorn(factory, runtimeBytes, packageBytes, corrupt);
  } catch {
    rejected = true;
  }
  if (!rejected) throw Error("Unpinned WASM was admitted");
  const result = {
    schema: 1,
    kind: "unicorn-bulk-memory-inspection",
    inputs,
    inspectorSha256: sha(await raw(import.meta.path)),
    adapterSha256: sha(
      await raw(resolve(import.meta.dir, "../latest-unicorn-bulk.mjs")),
    ),
    counts: {
      comparisons: observations.length,
      matchingNativeErrors: observations.filter((o) => o.error).length,
      ownedCopyChecks: 1,
      heapGrowthChecks: 1,
      corruptBinaryRejections: 1,
    },
    heapGrowth: { before, after },
    observations,
    mismatches: 0,
    scope: {
      sameEmbeddedWasm: true,
      realUcMemRead: true,
      originalMemoryErrorsPreserved: true,
      browserRun: false,
    },
  };
  await Bun.write(
    `${cache}/research/unicorn-bulk-inspection.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ counts: result.counts, heapGrowth: result.heapGrowth }),
  );
} finally {
  for (const e of engines) e.close();
}

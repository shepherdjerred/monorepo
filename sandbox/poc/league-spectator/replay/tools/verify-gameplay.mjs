import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeDecoder } from "../native-decoder.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const { default: createUnicorn } = await import(
  pathToFileURL(`${cache}/public/vendor/unicorn_x86.mjs`)
);
const profile = await Bun.file(`${cache}/public/decoder/profile.json`).json();
Object.assign(
  profile.decoders,
  await Bun.file(new URL("../gameplay-profile.json", import.meta.url)).json(),
);
const engine = new NativeDecoder(
  await createUnicorn(),
  profile,
  new Uint8Array(
    await Bun.file(`${cache}/public/decoder/image.bin`).arrayBuffer(),
  ),
);
const samples = await Bun.file(`${cache}/gameplay-oracle.json`).json();
for (const sample of samples) {
  const observed = engine.observe(
    sample.name,
    Buffer.from(sample.payload, "hex"),
  );
  assert.equal(
    Buffer.from(observed.output).toString("hex"),
    sample.output,
    `${sample.name} object`,
  );
  assert.equal(
    Buffer.from(observed.heap).toString("hex"),
    sample.heap,
    `${sample.name} heap`,
  );
  const writes = observed.writes.map(([offset, size, value]) => [
    offset,
    size,
    Number(BigInt.asUintN(size * 8, value)),
  ]);
  // Compare low 32 bits for scalar semantic fields; JS cannot represent every u64 exactly.
  const scalar = (items) => items.filter(([, size]) => size <= 4);
  assert.deepEqual(
    scalar(writes),
    scalar(sample.writes),
    `${sample.name} scalar write trace`,
  );
}
engine.close();
console.log(
  `${samples.length} native/WASM packet object, heap, and scalar-write comparisons passed`,
);

// Extract the identical embedded WASM from the pinned, already executed runtime.
// Only the trusted string literal is evaluated offline. Browser code uses a
// normal instantiateWasm callback and does not evaluate source text.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: prepare-unicorn-bulk.mjs <cache>");
const cache = resolve(arg),
  source = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  bytes = new Uint8Array(await Bun.file(source).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  runtimeSha =
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
if (sha(bytes) !== runtimeSha) throw Error("Pinned Unicorn runtime changed");
const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  prefix = "function findWasmBinary(){return binaryDecode(",
  start = text.indexOf(prefix) + prefix.length;
if (
  start < prefix.length ||
  text.indexOf(prefix, start) !== -1 ||
  text[start] !== "'"
)
  throw Error("Unrecognized embedded WASM literal");
let end = start + 1;
while (end < text.length) {
  if (text[end] === "\\") {
    end += 2;
    continue;
  }
  if (text[end] === "'") break;
  end++;
}
if (text.slice(end, end + 3) !== "')}")
  throw Error("Unrecognized embedded WASM literal endpoint");
const decoder =
  "function binaryDecode(bin){for(var i=0,l=bin.length,o=new Uint8Array(l),c;i<l;++i){c=bin.charCodeAt(i);o[i]=~c>>8&c}return o}";
if (!text.includes(decoder)) throw Error("Embedded binary decoder changed");
const literal = new Function(
    `"use strict";return (${text.slice(start, end + 1)});`,
  )(),
  wasm = Uint8Array.from(literal, (c) => {
    const code = c.charCodeAt(0);
    return (~code >> 8) & code;
  });
if (!WebAssembly.validate(wasm))
  throw Error("Extracted runtime is not valid WASM");
const compiled = await WebAssembly.compile(wasm),
  exports = WebAssembly.Module.exports(compiled),
  memories = exports.filter((e) => e.kind === "memory");
if (memories.length !== 1)
  throw Error("Runtime must export exactly one linear memory");
const directory = `${cache}/public/latest-unicorn-bulk`,
  file = `runtime-${sha(wasm)}.wasm`;
await Bun.write(`${directory}/${file}`, wasm);
const meta = {
  schema: 1,
  kind: "pinned-unicorn-bulk-memory",
  runtimeSha256: runtimeSha,
  file,
  wasmSha256: sha(wasm),
  wasmBytes: wasm.length,
  memoryExport: memories[0].name,
  extractorSha256: sha(
    new Uint8Array(await Bun.file(import.meta.path).arrayBuffer()),
  ),
  scope: {
    unchangedEmbeddedWasm: true,
    originalUcMemRead: true,
    bulkHostCopy: true,
    browserSourceEvaluation: false,
  },
};
await Bun.write(`${directory}/package.json`, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));

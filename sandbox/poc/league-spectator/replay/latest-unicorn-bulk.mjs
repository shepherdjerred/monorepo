// Same pinned Unicorn WASM and uc_mem_read, with a bulk host-side result copy.
// Every call still crosses Unicorn's real memory API and retains its errors.
import { sha256 } from "./structural-comparison.mjs";

export const UNICORN_BULK_PACKAGE_SHA =
  "4ee54d8cabb99eb72b22d8f18aaf18f213013884f9d26e9c83bf58504c42d6ab";
const RUNTIME_SHA =
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
const WASM_SHA =
  "f7fe3327ddae281d828fd429ad1c66e7d11a58164009f80016e95312ebe3ec37";
let compiled;

export async function createLatestBulkUnicorn(
  factory,
  runtimeBytes,
  packageBytes,
  wasmBytes,
) {
  if (
    typeof factory !== "function" ||
    (await sha256(runtimeBytes)) !== RUNTIME_SHA ||
    (await sha256(packageBytes)) !== UNICORN_BULK_PACKAGE_SHA ||
    (await sha256(wasmBytes)) !== WASM_SHA
  )
    throw Error("Pinned Unicorn bulk-memory runtime and package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "pinned-unicorn-bulk-memory" ||
    meta.runtimeSha256 !== RUNTIME_SHA ||
    meta.wasmSha256 !== WASM_SHA ||
    meta.wasmBytes !== 706897 ||
    meta.memoryExport !== "Q" ||
    !meta.scope.unchangedEmbeddedWasm ||
    !meta.scope.originalUcMemRead ||
    meta.scope.browserSourceEvaluation
  )
    throw Error("Unsupported bulk-memory runtime contract");
  compiled ??= WebAssembly.compile(wasmBytes);
  const module = await compiled;
  let memory;
  const uc = await factory({
    instantiateWasm(imports, receiveInstance) {
      const instance = new WebAssembly.Instance(module, imports);
      memory = instance.exports[meta.memoryExport];
      if (!(memory instanceof WebAssembly.Memory))
        throw Error("Pinned Unicorn linear memory is absent");
      receiveInstance(instance, module);
      return instance.exports;
    },
  });
  if (
    !memory ||
    !["_malloc", "_free", "_uc_mem_read", "getValue", "strerror"].every(
      (k) => typeof uc[k] === "function",
    )
  )
    throw Error("Required Unicorn memory API is absent");
  const Original = uc.Unicorn;
  uc.Unicorn = class extends Original {
    constructor(...args) {
      super(...args);
      this.mem_read = (address, size) => {
        if (
          (typeof address !== "bigint" && !Number.isSafeInteger(address)) ||
          address < 0 ||
          BigInt(address) > 0xffffffffffffffffn ||
          !Number.isSafeInteger(size) ||
          size < 0 ||
          size > 0x7fffffff
        )
          throw Error("Invalid Unicorn bulk memory address/size");
        const pointer = uc._malloc(size);
        if (!pointer && size)
          throw Error("Unicorn bulk read allocation failed");
        try {
          const handle = uc.getValue(this.handle_ptr, "*"),
            result = uc._uc_mem_read(
              handle,
              BigInt(address),
              pointer,
              BigInt(size),
            );
          if (result !== uc.ERR_OK)
            throw Error(
              `Unicorn.js: Function uc_mem_read failed with code ${result}:\n${uc.strerror(result)}`,
            );
          // Read the current buffer after both native calls: malloc/Unicorn may
          // grow memory. Return an owned copy before freeing the temporary.
          return new Uint8Array(memory.buffer, pointer, size).slice();
        } finally {
          uc._free(pointer);
        }
      };
    }
  };
  return uc;
}

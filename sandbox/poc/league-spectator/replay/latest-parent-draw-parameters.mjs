// Original pre-submission parameter updates. Scene matrix, pass and instance
// offset are supplied inputs; material application and GPU draw are separate.
import { sha256 } from "./structural-comparison.mjs";
export const PARENT_DRAW_PARAMETERS_SHA =
  "eef575ebcdfe04d8961c09e71ad519eb73f79b2b11da7c735fa9e7c0614865d4";
export const PARENT_DRAW_CACHES_SHA =
  "c51bb85f843cd60e8be69c674ad4900a0de7b73ae664c55937f3ee0711948ac1";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
  freeze = (v) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  },
  hex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

export async function loadParentDrawParameterABI(bytes, profile) {
  if ((await sha256(bytes)) !== PARENT_DRAW_PARAMETERS_SHA)
    throw Error("Pinned parent draw parameter ABI required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-parent-draw-parameter-abi" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.cachePackageSha256 !== PARENT_DRAW_CACHES_SHA ||
    meta.prefix[0] !== 0x173d5f0 ||
    meta.prefix[1] !== 0x173d909 ||
    meta.parameterBytes !== 0x38 ||
    meta.parameterFactoryRva !== 0x1928420 ||
    meta.parameterVtableRva !== 0x2408b98 ||
    meta.memcmp.rva !== 0x1feea3e ||
    meta.memcmp.symbol !== "_memcmp" ||
    meta.memcmp.maximumBytes !== 64 ||
    !meta.scope.staticBuildDataOnly ||
    !meta.scope.originalDrawPrefix ||
    meta.scope.containsReplayEvents ||
    meta.scope.completeMaterialApplication ||
    meta.scope.gpuSubmission
  )
    throw Error("Unsupported original parent draw parameter ABI");
  return freeze(meta);
}

export function validateParentDrawCache(k, cache) {
  const data = cache.drawParameters,
    abi = k.drawABI;
  if (
    !abi ||
    !data ||
    data.prefix[0] !== abi.prefix[0] ||
    data.prefix[1] !== abi.prefix[1] ||
    k.allocations.get(data.scene) !== abi.sceneBytes ||
    k.allocations.get(data.wrapper) !== 8 ||
    k.allocations.get(data.command) !== 16 ||
    k.allocations.get(data.material) !== 8 ||
    Object.keys(data.slots).length !== Object.keys(abi.slotVectors).length
  )
    throw Error("Draw parameter cache omits its owned registry/IO");
  for (const [name, vectors] of Object.entries(abi.slotVectors)) {
    const slot = data.slots[name];
    if (
      !slot ||
      slot.vectors !== vectors ||
      k.allocations.get(slot.pointer) !== abi.parameterBytes ||
      k.allocations.get(k.q(slot.pointer + 8)) !== vectors * 16 ||
      k.q(slot.pointer) !== k.base + abi.parameterVtableRva ||
      new DataView(k.read(slot.pointer + 0x10, 8).buffer).getUint32(0, true) !==
        vectors ||
      new DataView(k.read(slot.pointer + 0x10, 8).buffer).getUint32(4, true) !==
        slot.hash
    )
      throw Error("Draw parameter slot differs from the original constructor");
  }
}

export function routeParentDrawMemcmp(k) {
  const spec = k.drawABI?.memcmp,
    first = k.reg("RDI"),
    second = k.reg("RSI"),
    count = k.reg("RDX"),
    caller = k.q(k.reg("RSP")) - k.base;
  if (
    !spec ||
    count > spec.maximumBytes ||
    !spec.callerRvas.includes(caller) ||
    !k.libraryPointer(first, count) ||
    !k.libraryPointer(second, count)
  )
    throw Error("Unowned parent draw C memory comparison");
  const left = k.read(first, count),
    right = k.read(second, count);
  let result = 0;
  for (let i = 0; i < count; i++)
    if (left[i] !== right[i]) {
      result = left[i] - right[i];
      break;
    }
  if (k.captureDrawComparisons)
    k.drawMemcmpCalls.push({
      callerRva: caller,
      bytes: count,
      leftHex: hex(left),
      rightHex: hex(right),
      result,
    });
  k.engine.reg_write_i64(k.uc.X86_REG_RAX, BigInt.asUintN(64, BigInt(result)));
  k.ret();
}

export function evaluateParentDrawParameters(
  k,
  cache,
  ownership,
  emitterIndex,
  inputs,
  { binary = false } = {},
) {
  if (
    !k.drawABI ||
    !cache.drawParameters ||
    k.nativeRunning ||
    typeof binary !== "boolean" ||
    !uint(emitterIndex) ||
    !inputs ||
    !uint(inputs.passHash) ||
    !uint(inputs.instanceOffset) ||
    !Array.isArray(inputs.projectionSource) ||
    inputs.projectionSource.length !== 16 ||
    !inputs.projectionSource.every(
      (v) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        Number.isFinite(Math.fround(v)),
    )
  )
    throw Error(
      "Explicit owned draw emitter, finite matrix, pass and offset required",
    );
  const actors = ownership.actors.filter(
    (a) => a.kind === "complex" && a.emitterIndex === emitterIndex,
  );
  if (actors.length !== 1)
    throw Error("Draw parameter emitter is not owned by this parent");
  const actor = actors[0],
    data = cache.drawParameters;
  if (
    k.q(actor.pointer) !== ownership.parent ||
    k.q(actor.pointer + 8) !== actor.link ||
    k.q(actor.link + 0x10) !== actor.definition
  )
    throw Error("Draw parameter actor ownership changed");
  const before = {};
  for (const [name, slot] of Object.entries(data.slots))
    before[name] = k.read(k.q(slot.pointer + 8), slot.vectors * 16);
  k.u64(data.wrapper, actor.pointer);
  k.put(data.command, [inputs.instanceOffset], "u32");
  k.u64(data.material, k.q(actor.link + 0x88));
  k.put(data.scene + k.drawABI.matrixOffset, inputs.projectionSource);
  k.drawMemcmpCalls = [];
  k.captureDrawComparisons = !binary;
  try {
    k.callNative(
      k.drawABI.prefix[0],
      {
        RDI: data.wrapper,
        RSI: data.scene,
        RDX: inputs.passHash,
        RCX: data.command,
        R8: data.material,
      },
      k.drawABI.prefix[1],
    );
  } finally {
    k.captureDrawComparisons = false;
  }
  const values = {},
    changed = [];
  for (const [name, slot] of Object.entries(data.slots)) {
    const bytes = k.read(k.q(slot.pointer + 8), slot.vectors * 16);
    if (bytes.some((v, i) => v !== before[name][i])) changed.push(name);
    values[name] = binary ? bytes : hex(bytes);
  }
  return {
    emitterIndex,
    passHash: inputs.passHash,
    instanceOffset: inputs.instanceOffset,
    projectionSource: inputs.projectionSource.slice(),
    values,
    changed,
    ...(binary ? {} : { memcmpCalls: k.drawMemcmpCalls }),
  };
}

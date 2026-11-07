import { sha256 } from "./structural-comparison.mjs";
import { WORLD_EFFECT_ABI_SHA } from "./latest-world-effect-abi.mjs";
export const WORLD_DESCRIPTOR_ABI_SHA =
  "97c4d936b99c0f17a8d3460d0a395a9d33907a7cc85f3b73be0bfabf2e1e35b9";
const freeze = (v) => {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
};
export async function loadLatestWorldDescriptorABI(bytes, profile, worldABI) {
  if (!worldABI || (await sha256(bytes)) !== WORLD_DESCRIPTOR_ABI_SHA)
    throw Error("Pinned descriptor ABI and world helper extension required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-detached-world-descriptor-abi" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.worldHelperAbiSha256 !== WORLD_EFFECT_ABI_SHA ||
    meta.effectsManifestSha256 !== worldABI.effectsManifestSha256 ||
    meta.sharedImports.lock.rva !== 0x1fee4ec ||
    meta.sharedImports.lock.symbol !==
      "__ZNSt3__119__shared_weak_count4lockEv" ||
    meta.sharedImports.releaseWeak.rva !== 0x1fee4e6 ||
    meta.sharedImports.releaseWeak.symbol !==
      "__ZNSt3__119__shared_weak_count14__release_weakEv" ||
    meta.sharedImports.maximumOwners !== 65536 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    !meta.scope.completeOriginalDescriptorFactory ||
    !meta.scope.explicitDetachedDescriptors ||
    !meta.scope.suppliedSingleDefinitionResolver ||
    meta.scope.decodedReplayRequestsExecuted ||
    meta.scope.entityBoneAttachments ||
    meta.scope.replayWorldStateRecovered
  )
    throw Error("Unsupported detached descriptor factory build/contract");
  return freeze(meta);
}

// Single-thread libc++ boundary. Destruction tail-calls original game code.
// Semantics: llvm-project/libcxx/src/memory.cpp, __shared_weak_count.
export function routeWorldSharedOwnership(k, at) {
  const abi = k.descriptorABI,
    e = k.engine,
    uc = k.uc,
    lock = at === abi.sharedImports.lock.rva,
    spec = lock ? abi.sharedImports.lock : abi.sharedImports.releaseWeak,
    control = k.reg("RDI");
  if (at !== spec.rva || k.allocations.get(control) !== 0x20)
    throw Error("Shared ownership import requires an owned control block");
  const offset = lock ? 8 : 16,
    owners = Number(
      new DataView(k.read(control + offset, 8).buffer).getBigInt64(0, true),
    );
  if (
    !Number.isSafeInteger(owners) ||
    owners < -1 ||
    owners > abi.sharedImports.maximumOwners
  )
    throw Error("Unbounded shared ownership count");
  const record = { name: spec.symbol, control, owners };
  if (lock) {
    if (owners !== -1) k.u64(control + 8, owners + 1);
    const result = owners !== -1 ? control : 0;
    record.result = result;
    e.reg_write_i64(uc.X86_REG_RAX, BigInt(result));
    k.ret();
  } else if (owners > 0) {
    k.u64(control + 16, owners - 1);
    k.ret();
  } else if (owners === 0) {
    const callback = k.q(k.q(control) + 0x18);
    if (callback < k.base || callback >= k.base + k.image.length)
      throw Error("Shared ownership destructor is outside original image");
    record.destructorRva = callback - k.base;
    e.reg_write_i64(uc.X86_REG_RIP, BigInt(callback));
  } else throw Error("Released weak control block reused");
  k.hostCalls.push(record);
}

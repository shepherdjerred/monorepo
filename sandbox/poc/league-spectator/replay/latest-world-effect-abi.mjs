import { sha256 } from "./structural-comparison.mjs";
export const WORLD_EFFECT_ABI_SHA =
  "12685030917fb429a5b7e6ef0366bb29cc1348fe76210405e3e7a7270a3110eb";
export async function loadLatestWorldEffectABI(
  bytes,
  profile,
  parentRuntimeSha,
) {
  if ((await sha256(bytes)) !== WORLD_EFFECT_ABI_SHA)
    throw Error("Pinned world effect ABI required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-world-effect-helper-abi" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.parentRuntimeAbiSha256 !== parentRuntimeSha ||
    meta.nextPrime.rva !== 0x1fee34e ||
    meta.nextPrime.symbol !== "__ZNSt3__112__next_primeEm" ||
    meta.nextPrime.maximumInput !== 65536 ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    !meta.scope.suppliedSingleDefinitionResolver ||
    !meta.scope.unitContextsSuppliedEmpty ||
    meta.scope.decodedDescriptorFinalization ||
    meta.scope.entityBoneAttachments ||
    meta.scope.replayWorldStateRecovered
  )
    throw Error("Unsupported world effect ABI/build/scope");
  return Object.freeze(meta);
}

export function boundedWorldNextPrime(value, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum ||
    maximum !== 65536
  )
    throw Error("World registry next-prime input exceeds libc++ boundary");
  if (value === 0) return 0;
  let candidate = Math.max(2, value);
  for (;;) {
    let prime = true;
    for (let d = 2; d * d <= candidate; d++)
      if (candidate % d === 0) {
        prime = false;
        break;
      }
    if (prime) return candidate;
    candidate++;
  }
}

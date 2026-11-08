import { sha256 } from "./structural-comparison.mjs";

export const BUILTIN_RESOURCE_CONTEXTS_SHA =
  "3fab8bb246b194bce340574b555b0eb3f271ff288e2cdd00c8ef6c2ae545cbb5";

// This recognizes the original published Shared interface. Missing identities
// require their actual registry history; a cold-control miss is not that history.
export async function createLatestBuiltinResourceContexts({
  profile,
  packageBytes,
}) {
  if ((await sha256(packageBytes)) !== BUILTIN_RESOURCE_CONTEXTS_SHA)
    throw Error("Pinned built-in resource context program required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-builtin-resource-context-programs" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.shared.identity !== 3579051965 ||
    meta.shared.resourceGetterRva !== 0x35a270 ||
    meta.shared.resolver !== null ||
    meta.unknownIdentityPolicy !==
      "unresolved-until-causal-registry-established" ||
    !meta.scope.staticBuildDataOnly ||
    !meta.scope.sharedNullGetterObserved ||
    meta.scope.containsReplayEvents ||
    meta.scope.containsRegistryInstances ||
    meta.scope.actualReplayRegistryRecovered ||
    meta.scope.globalResourceMapsRecovered
  )
    throw Error("Unsupported built-in resource context program contract");
  return Object.freeze({
    metadata: Object.freeze({
      build: meta.build,
      protocol: meta.protocol,
      packageSha256: BUILTIN_RESOURCE_CONTEXTS_SHA,
      unknownIdentityPolicy: meta.unknownIdentityPolicy,
    }),
    lookup(identity) {
      if (!Number.isInteger(identity) || identity < 0 || identity > 0xffffffff)
        throw Error("Unsigned context identity required");
      return identity === meta.shared.identity
        ? Object.freeze({
            status: "known-null-resource-resolver",
            identity,
            contextKind: "built-in-shared",
            originalGetterRva: meta.shared.resourceGetterRva,
          })
        : null;
    },
  });
}

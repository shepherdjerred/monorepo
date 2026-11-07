// Original resource projection over explicitly supplied post-storage entries and
// cache keys. This does not infer accepted appearances, asset readiness or a live
// unit resource stack from replay requests.
import { sha256 } from "./structural-comparison.mjs";

export const APPEARANCE_RESOURCES_SHA =
  "4d3fdbcb14274b59ff683d9cc0e9c369fd324387a99a06db9206a8f7eadd3735";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
const fold = (value) =>
  value.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export async function createLatestAppearanceResources({
  profile,
  image,
  packageBytes,
}) {
  if (
    !(image instanceof Uint8Array) ||
    !(packageBytes instanceof Uint8Array) ||
    (await sha256(packageBytes)) !== APPEARANCE_RESOURCES_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned appearance resource package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(packageBytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-original-appearance-resource-projection" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    profile.constructorImageSha256 !== meta.constructorImageSha256 ||
    meta.contract.localPlayer !== "absent" ||
    meta.contract.alternateCharacters !== "empty" ||
    meta.contract.modifierNames !== "empty" ||
    meta.contract.resourceCache !== "explicit-prepared-keys-only" ||
    meta.contract.stackState !== "explicit-supplied-post-storage-entries" ||
    !meta.scope.staticBuildDataOnly ||
    meta.scope.containsReplayEvents ||
    meta.scope.fullAssetLoaderExecuted ||
    meta.scope.liveAppearanceStateRecovered ||
    meta.scope.mainViewerExpanded
  )
    throw Error("Unsupported appearance resource build/contract");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original appearance resource instructions changed");
  const encoder = new TextEncoder(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  function text(value) {
    if (typeof value !== "string" || value.includes("\0"))
      throw Error("Explicit appearance key string required");
    const bytes = encoder.encode(value);
    if (bytes.length > 4096 || decoder.decode(bytes) !== value)
      throw Error("Bounded valid appearance key string required");
    return value;
  }
  function key(input) {
    if (!input || !uint(input.skinId) || !uint(input.keyFlags))
      throw Error("Explicit unsigned appearance cache key required");
    return {
      name: text(input.name),
      namespace: text(input.namespace),
      skinId: input.skinId,
      keyFlags: input.keyFlags,
    };
  }
  function identity(value) {
    return JSON.stringify([
      fold(value.name),
      fold(value.namespace),
      value.skinId,
      value.keyFlags,
    ]);
  }
  function entry(input) {
    if (
      !input ||
      !Array.isArray(input.flags) ||
      input.flags.length !== 5 ||
      input.flags.some((v) => typeof v !== "boolean") ||
      !Number.isInteger(input.gearIndex) ||
      input.gearIndex < 0 ||
      input.gearIndex > 255 ||
      !Array.isArray(input.modifierNames) ||
      input.modifierNames.length !== 0 ||
      input.alternateCharacterA !== "" ||
      input.alternateCharacterB !== ""
    )
      throw Error(
        "Supplied appearance entry needs five flags, a gear byte and empty modifiers/alternates",
      );
    return {
      key: key(input.key),
      flags: [...input.flags],
      gearIndex: input.gearIndex,
      modifierNames: [],
    };
  }
  function projectSuppliedStack({ stack, preparedCache }) {
    if (
      stack?.localPlayer !== "absent" ||
      !Array.isArray(stack.entries) ||
      stack.entries.length > 256 ||
      !Array.isArray(preparedCache) ||
      preparedCache.length === 0 ||
      preparedCache.length > 4096
    )
      throw Error(
        "Bounded supplied appearance stack, absent local player and prepared cache required",
      );
    const cache = new Map(),
      ids = new Set();
    for (const input of preparedCache) {
      const cacheKey = key(input.key),
        id = text(input.handleId),
        normalized = identity(cacheKey);
      if (
        !id ||
        ids.has(id) ||
        cache.has(normalized) ||
        (input.contextIdentity !== null && !uint(input.contextIdentity))
      )
        throw Error(
          "Unique explicit appearance cache handles/keys and context identities required",
        );
      ids.add(id);
      cache.set(
        normalized,
        freeze({
          handleId: id,
          key: cacheKey,
          contextIdentity: input.contextIdentity,
        }),
      );
    }
    const entries = stack.entries.map(entry).reverse(),
      defaultEntry = entry(stack.defaultEntry),
      selected = Array(6).fill(null);
    let gearIndex = 255;
    entries.push(defaultEntry);
    for (const input of entries) {
      if (!input.key.name) continue;
      const resource = cache.get(identity(input.key));
      // A cache miss enters the native asset loader. Its readiness/failure is
      // unresolved here, so it cannot silently fall through to an older entry.
      if (!resource)
        throw Error(
          "Appearance resource requires unprepared native asset loading",
        );
      if (selected[2] === null) {
        selected[2] = resource;
        gearIndex = input.gearIndex;
      }
      const flags = input.flags;
      if (!flags[1]) {
        if (selected[0] === null) selected[0] = resource;
        if (selected[1] === null && flags[2]) selected[1] = resource;
        if (selected[3] === null && flags[0]) selected[3] = resource;
        if (selected[4] === null && flags[4]) selected[4] = resource;
      }
      if (selected[5] === null && flags[3]) selected[5] = resource;
    }
    return freeze({
      status: "supplied-appearance-resource-projection",
      channels: Object.fromEntries(
        meta.channels.map((name, i) => [name, selected[i]]),
      ),
      gearIndex,
      modifierNames: [],
      acceptedLiveAppearanceVerified: false,
      resourceCacheReadinessVerified: false,
      unitCallbacksExecuted: false,
    });
  }
  return Object.freeze({ metadata: freeze(meta), projectSuppliedStack });
}

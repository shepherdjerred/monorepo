const exact = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const pathValid = (value) =>
  typeof value === "string" &&
  value.length <= 512 &&
  /^[-A-Za-z0-9_./]+$/.test(value) &&
  !value.startsWith("/") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
const kinds = {
  build: "approved-exact-build-public",
  scene: "prepared-scene-public",
  animation: "prepared-scene-animation",
};

// Composed, source-bound material authorities retain original native controls
// and can exceed16MiB. The immutable build/scene/animation quotas stay16MiB.
export const selectedStaticSourceIdentityByteLimit = (kind) =>
  (kind === "prepared-scene-package" ? 32 : 16) * 1024 * 1024;

export function assertSelectedStaticSourceAuthorities(catalog, profileSha256) {
  const sources = catalog.sourceAuthorities;
  if (
    !sources ||
    !Object.hasOwn(sources, "build") ||
    !Object.hasOwn(sources, "scene") ||
    Object.keys(sources).length > 32 ||
    Object.keys(sources).some((key) => !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key))
  )
    throw Error("Explicit selected build/scene authorities required");
  for (const [authority, source] of Object.entries(sources)) {
    if (
      !exact(source, ["kind", "identity"]) ||
      source.kind !==
        (Object.hasOwn(kinds, authority)
          ? kinds[authority]
          : "prepared-scene-package") ||
      !exact(source.identity, ["file", "sha256", "bytes"]) ||
      !pathValid(source.identity.file) ||
      !digest(source.identity.sha256) ||
      !Number.isSafeInteger(source.identity.bytes) ||
      source.identity.bytes < 1 ||
      source.identity.bytes > selectedStaticSourceIdentityByteLimit(source.kind)
    )
      throw Error("Invalid selected source authority identity");
  }
  if (
    sources.build.identity.file !== "decoder-16.21-macos/profile.json" ||
    sources.build.identity.sha256 !== profileSha256
  )
    throw Error(
      "Selected build authority differs from immutable bootstrap profile",
    );
  for (const entry of Object.values(catalog.files)) {
    if (
      !exact(entry, ["sha256", "bytes", "source"]) ||
      !exact(entry.source, ["authority", "file"]) ||
      !Object.hasOwn(sources, entry.source.authority) ||
      !pathValid(entry.source.file)
    )
      throw Error("Explicit source identity required for every selected file");
  }
  for (const [authority, { identity }] of Object.entries(sources)) {
    if (authority === "build") continue;
    if (
      !Object.values(catalog.files).some(
        (entry) =>
          entry.source.authority === authority &&
          entry.source.file === identity.file &&
          entry.sha256 === identity.sha256 &&
          entry.bytes === identity.bytes,
      )
    )
      throw Error(
        "Selected source identity absent from inventory: " + authority,
      );
  }
  function assertIdentity(role, authority) {
    const entry = catalog.files[catalog.roles[role]],
      identity = sources[authority].identity;
    if (
      !entry ||
      entry.source.authority !== authority ||
      entry.source.file !== identity.file ||
      entry.sha256 !== identity.sha256 ||
      entry.bytes !== identity.bytes
    )
      throw Error("Selected role differs from source authority: " + role);
  }
  assertIdentity("scene", "scene");
  const image = catalog.files["decoder-16.21-macos/image.bin"];
  if (
    !image ||
    image.source.authority !== "build" ||
    image.source.file !== "decoder-16.21-macos/image.bin" ||
    image.sha256 !== catalog.decoderImageSha256
  )
    throw Error("Selected image must retain exact build source identity");
  if (sources.animation) {
    assertIdentity("sceneAnimationAuthority", "animation");
    for (const role of [
      "sceneAnimationClock",
      "sceneAnimationRig",
      "sceneAnimationEventInventory",
      "sceneAnimationLeafPoses",
    ])
      if (catalog.files[catalog.roles[role]]?.source.authority !== "animation")
        throw Error(
          "Explicit selected animation role authority required: " + role,
        );
    for (const file of [
      "animation-clock.json",
      "animation-rigs.json",
      "animation-events.json",
      "animation-poses.json",
    ])
      if (Object.hasOwn(catalog.files, "decoder-16.21-macos/" + file))
        throw Error(
          "Scene animation roles cannot relabel historical decoder metadata",
        );
  }
}

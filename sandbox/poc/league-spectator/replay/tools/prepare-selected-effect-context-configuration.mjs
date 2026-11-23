// Closed proof input for the actual selected context/resolver factories. This
// selects no material mode and does not establish renderer readiness.
import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { BUILTIN_RESOURCE_CONTEXTS_SHA } from "../latest-builtin-resource-contexts.mjs";
import { assertSceneAnimationAuthorityIdentity } from "../scene-animation-authority.mjs";
import { validateSelectedStaticSourcePlan } from "./selected-static-sources.mjs";

const [
  buildRoot,
  sceneRoot,
  animationRoot,
  effectsRoot,
  resourceRoot,
  poseRoot,
  outputFile,
] = process.argv.slice(2);
if (!outputFile || process.argv.length !== 9)
  throw Error(
    "Usage: bun prepare-selected-effect-context-configuration.mjs <approved-public> <scene-public> <animation-root> <effects-root> <effect-resource-root> <viewer-pose-root> <configuration.json>",
  );
const roots = Object.fromEntries(
  Object.entries({
    build: buildRoot,
    scene: sceneRoot,
    animation: animationRoot,
    effects: effectsRoot,
    effectResources: resourceRoot,
    viewerPoses: poseRoot,
  }).map(([key, value]) => [key, path.resolve(value)]),
);
const inputs = {};
async function raw(authority, file) {
  const absolute = path.resolve(roots[authority], file),
    bytes = await Bun.file(absolute).bytes(),
    hash = await sha256(bytes);
  if (inputs[absolute] && inputs[absolute] !== hash)
    throw Error("Context configuration source changed");
  inputs[absolute] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const identity = async (authority, file) => {
  const bytes = await raw(authority, file);
  return { file, bytes: bytes.length, sha256: await sha256(bytes) };
};
const profileFile = "decoder-16.21-macos/profile.json",
  sceneFile = "latest-scene/manifest.json";
const profileBytes = await raw("build", profileFile),
  profile = decode(profileBytes),
  sceneBytes = await raw("scene", sceneFile),
  scene = decode(sceneBytes),
  animationBytes = await raw("animation", "manifest.json"),
  animation = decode(animationBytes),
  effectsBytes = await raw("effects", "manifest.json"),
  effects = decode(effectsBytes),
  resourceBytes = await raw("effectResources", "manifest.json"),
  resources = decode(resourceBytes),
  poseBytes = await raw("viewerPoses", "package.json"),
  poses = decode(poseBytes),
  imageBytes = await raw("build", "decoder-16.21-macos/image.bin");
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  scene.map.id !== 11 ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest ||
  (await sha256(imageBytes)) !== profile.decoderImageSha256
)
  throw Error("Exact archived scene/build input identities required");
const profileSha256 = await sha256(profileBytes),
  sceneSha256 = await sha256(sceneBytes),
  effectsSha256 = await sha256(effectsBytes),
  animationSha256 = await sha256(animationBytes);
assertSceneAnimationAuthorityIdentity(animation, {
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  baseProfileSha256: profileSha256,
  imageSha256: profile.decoderImageSha256,
  sceneManifestSha256: sceneSha256,
});
if (
  effects.sceneManifestSha256 !== sceneSha256 ||
  effects.build !== scene.build ||
  effects.protocol !== scene.protocol ||
  resources.kind !== "prepared-scene-effect-resource-authority" ||
  resources.schema !== 2 ||
  resources.sceneManifestSha256 !== sceneSha256 ||
  resources.effectsManifestSha256 !== effectsSha256 ||
  poses.kind !== "pinned-static-viewer-pose-assets" ||
  poses.sceneManifestSha256 !== sceneSha256 ||
  poses.sceneAnimationAuthoritySha256 !== animationSha256 ||
  poses.baseProfileSha256 !== profileSha256
)
  throw Error(
    "Matching genuine scene/effects/resource/model metadata required",
  );
const plan = {
  schema: 1,
  kind: "selected-static-source-plan",
  sources: {},
  files: {},
};
for (const [authority, kind, file] of [
  ["build", "approved-exact-build-public", profileFile],
  ["scene", "prepared-scene-public", sceneFile],
  ["animation", "prepared-scene-animation", "manifest.json"],
  ["effects", "prepared-scene-package", "manifest.json"],
  ["effectResources", "prepared-scene-package", "manifest.json"],
  ["viewerPoses", "prepared-scene-package", "package.json"],
])
  plan.sources[authority] = { kind, identity: await identity(authority, file) };
function declare(target, authority, file, ref) {
  const entry = {
      source: { authority, file },
      sha256: ref.sha256,
      bytes: ref.bytes,
    },
    previous = plan.files[target];
  if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
    throw Error("Conflicting explicit source declaration: " + target);
  plan.files[target] = entry;
}
for (const [authority, prefix] of [
  ["build", ""],
  ["scene", ""],
  ["animation", "scene-animation/"],
  ["effects", "latest-effects/"],
  ["effectResources", "latest-effect-resources/"],
  ["viewerPoses", "latest-viewer-poses/"],
]) {
  const ref = plan.sources[authority].identity;
  declare(prefix + ref.file, authority, ref.file, ref);
}
declare(
  "decoder-16.21-macos/image.bin",
  "build",
  "decoder-16.21-macos/image.bin",
  { sha256: profile.decoderImageSha256, bytes: imageBytes.length },
);
for (const ref of scene.files)
  declare("latest-scene/" + ref.path, "scene", "latest-scene/" + ref.path, ref);
for (const ref of effects.files)
  declare("latest-effects/" + ref.path, "effects", ref.path, ref);
for (const ref of resources.files)
  declare(
    "latest-effect-resources/" + ref.file,
    "effectResources",
    ref.file,
    ref,
  );
const roles = {
  scene: sceneFile,
  effects: "latest-effects/manifest.json",
  viewerPoses: "latest-viewer-poses/package.json",
  sceneAnimationAuthority: "scene-animation/manifest.json",
  builtinResourceContexts: "latest-builtin-resource-contexts/package.json",
};
const animationRoles = {
  clock: "sceneAnimationClock",
  rig: "sceneAnimationRig",
  eventInventory: "sceneAnimationEventInventory",
  leafPoses: "sceneAnimationLeafPoses",
};
for (const [name, ref] of Object.entries(animation.roles)) {
  const target = "scene-animation/" + ref.file;
  declare(target, "animation", ref.file, ref);
  roles[animationRoles[name]] = target;
  for (const dependency of ref.dependsOn) {
    if (dependency.authority === "native")
      declare(
        "decoder-16.21-macos/" + dependency.file,
        "build",
        "decoder-16.21-macos/" + dependency.file,
        dependency,
      );
    else if (dependency.authority === "scene")
      declare(
        "latest-scene/" + dependency.file,
        "scene",
        "latest-scene/" + dependency.file,
        dependency,
      );
    else if (dependency.authority === "derived")
      declare(
        "scene-animation/" + dependency.file,
        "animation",
        dependency.file,
        dependency,
      );
    else throw Error("Unknown animation source authority");
  }
}
for (const [role, file] of Object.entries(resources.roles))
  roles[role] = "latest-effect-resources/" + file;
for (const [file, expected] of [
  [
    "latest-builtin-resource-contexts/package.json",
    BUILTIN_RESOURCE_CONTEXTS_SHA,
  ],
  ["vendor/three.core.js", poses.mathSha256],
]) {
  const bytes = await raw("build", file);
  if ((await sha256(bytes)) !== expected)
    throw Error("Exact build-owned context/math resource required");
  declare(file, "build", file, { bytes: bytes.length, sha256: expected });
}
validateSelectedStaticSourcePlan(plan);
for (const [file, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(file).bytes())) !== hash)
    throw Error("Context configuration input changed before publication");
await Bun.write(
  path.resolve(outputFile),
  JSON.stringify({ plan, roots, roles }, null, 2),
);
console.log(
  JSON.stringify({
    configuration: path.resolve(outputFile),
    files: Object.keys(plan.files).length,
    authorities: Object.keys(roots),
    roles: Object.keys(roles),
    materialModeSelected: false,
    nativeSpectatorAdmitted: false,
  }),
);

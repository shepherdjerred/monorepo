// Select static content after its producers finish; never rewrites the profile.
import { resolve, dirname } from "node:path";
import { readdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import {
  STATIC_CATALOG_POLICY,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
  loadLatestStaticCatalogSelection,
} from "../latest-static-catalog.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { WORLD_STATE_SHA } from "../latest-world-state-contract.mjs";
import { EFFECT_RESOLVERS_PACKAGE_SHA } from "../latest-effect-resolver-contract.mjs";
import { UNIT_RESOURCES_PACKAGE_SHA } from "../latest-unit-resources.mjs";
import { INITIAL_RESOURCE_PREFIX_PACKAGE_SHA } from "../latest-initial-resource-prefix-contract.mjs";
import { NEGATIVE_FORM_PREFIX_PACKAGE_SHA } from "../latest-negative-form-prefix-contract.mjs";
import { CORPSE_POLICY_SHA } from "../latest-corpse.mjs";
import { SUBMESH_VISIBILITY_SHA } from "../latest-submesh-visibility.mjs";
import { ITEM_ASSETS_SHA } from "../latest-item-assets.mjs";
import {
  EFFECT_PLACEMENT_PACKAGE_SHA,
  EFFECT_DESCRIPTOR_PACKAGE_SHA,
} from "../latest-effect-packet-contract.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { SELECTED_BUILD_PROGRAMS } from "./selected-build-programs.mjs";
import { DIRECT_NAV_CAMERA_PACKAGE_SHA } from "../latest-direct-nav-ground-materials.mjs";
const [cacheArg, worldStateReferenceArg] = process.argv.slice(2);
if (!cacheArg || !worldStateReferenceArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-selected-static-catalog.mjs <cache> <approved-world-state-package>",
  );
const cache = resolve(cacheArg),
  inputs = {},
  files = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const profileBytes = await load("decoder-16.21-macos/profile.json"),
  profile = decode(profileBytes),
  scene = decode(await load("latest-scene/manifest.json"));
if (
  profile.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256 ||
  profile.clientVersion !== scene.build ||
  profile.protocolDigest !== scene.protocol
)
  throw Error("Approved exact-build static profile required");
const proof = await raw(`${cache}/research/effect-contexts-native.json`),
  proofPath = "latest-static-catalog/effect-contexts-native.json";
await Bun.write(`${cache}/public/${proofPath}`, proof);
const worldStateReference = await raw(worldStateReferenceArg),
  worldStateReferencePath = "latest-static-catalog/world-state-reference.json";
if ((await sha256(worldStateReference)) !== WORLD_STATE_SHA)
  throw Error("Fixed approved native world-schema reference required");
await Bun.write(
  `${cache}/public/${worldStateReferencePath}`,
  worldStateReference,
);
const programReferenceRoot = resolve(dirname(worldStateReferenceArg), "..");
const fixedProgramPaths = [];
for (const [sourcePath, selectedPath, expected] of [
  [
    "latest-effect-resolvers/package.json",
    "latest-static-catalog/effect-resolvers-reference.json",
    EFFECT_RESOLVERS_PACKAGE_SHA,
  ],
  [
    "latest-unit-resources/package.json",
    "latest-unit-resources/package.json",
    UNIT_RESOURCES_PACKAGE_SHA,
  ],
  [
    "latest-initial-resource-prefix/package.json",
    "latest-initial-resource-prefix/package.json",
    INITIAL_RESOURCE_PREFIX_PACKAGE_SHA,
  ],
  [
    "latest-negative-form-prefix/package.json",
    "latest-negative-form-prefix/package.json",
    NEGATIVE_FORM_PREFIX_PACKAGE_SHA,
  ],
  [
    "latest-corpse/package.json",
    "latest-static-catalog/corpse-policy-reference.json",
    CORPSE_POLICY_SHA,
  ],
  [
    "latest-submesh-visibility/package.json",
    "latest-static-catalog/submesh-visibility-reference.json",
    SUBMESH_VISIBILITY_SHA,
  ],
  [
    "latest-effect-placement/package.json",
    "latest-static-catalog/effect-placement-reference.json",
    EFFECT_PLACEMENT_PACKAGE_SHA,
  ],
  [
    "latest-effect-descriptor/package.json",
    "latest-static-catalog/effect-descriptor-reference.json",
    EFFECT_DESCRIPTOR_PACKAGE_SHA,
  ],
]) {
  const bytes = await raw(`${programReferenceRoot}/${sourcePath}`);
  if ((await sha256(bytes)) !== expected)
    throw Error("Fixed original resource program required: " + sourcePath);
  const target = `${cache}/public/${selectedPath}`;
  if (await Bun.file(target).exists()) {
    if ((await sha256(await raw(target))) !== expected)
      throw Error(
        "Cannot replace differing selected resource program: " + selectedPath,
      );
  } else await Bun.write(target, bytes);
  fixedProgramPaths.push(selectedPath);
}
const resolverProofPath = "latest-static-catalog/effect-resolvers-native.json";
await Bun.write(
  `${cache}/public/${resolverProofPath}`,
  await raw(`${cache}/research/effect-resolvers-native.json`),
);
const submeshProofPath = "latest-static-catalog/submesh-visibility-native.json";
await Bun.write(
  `${cache}/public/${submeshProofPath}`,
  await raw(`${cache}/research/submesh-visibility-native.json`),
);
async function add(path) {
  if (
    typeof path !== "string" ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^[a-zA-Z0-9_.\/-]+$/.test(path)
  )
    throw Error("Bounded selected static path required");
  const bytes = await load(path);
  files[path] = { sha256: await sha256(bytes), bytes: bytes.length };
}
// Item presentation is build-wide, independent of the chosen lineup. Copy
// exactly the already-approved package and its declared content-addressed icons.
const itemPackagePath = "latest-items/package.json",
  itemPackageBytes = await raw(`${programReferenceRoot}/${itemPackagePath}`);
if ((await sha256(itemPackageBytes)) !== ITEM_ASSETS_SHA)
  throw Error("Fixed installed item presentation package required");
const itemFiles = new Map([
  [itemPackagePath, { bytes: itemPackageBytes, sha256: ITEM_ASSETS_SHA }],
]);
for (const item of Object.values(decode(itemPackageBytes).items)) {
  if (!/^icons\/[a-f0-9]{64}\.png$/.test(item.icon))
    throw Error("Content-addressed installed item icon required");
  const path = `latest-items/${item.icon}`;
  if (!itemFiles.has(path))
    itemFiles.set(path, {
      bytes: await raw(`${programReferenceRoot}/${path}`),
      sha256: item.iconSha256,
    });
  if (itemFiles.get(path).sha256 !== item.iconSha256)
    throw Error("Conflicting installed item icon declaration");
}
for (const [path, ref] of itemFiles) {
  if ((await sha256(ref.bytes)) !== ref.sha256)
    throw Error("Installed item icon bytes differ");
  const target = `${cache}/public/${path}`;
  if (await Bun.file(target).exists()) {
    if ((await sha256(await raw(target))) !== ref.sha256)
      throw Error("Cannot replace differing installed item asset");
  } else await Bun.write(target, ref.bytes);
  await add(path);
}
async function tree(path) {
  for (const entry of await readdir(`${cache}/public/${path}`, {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink())
      throw Error("Selected static catalog cannot follow links");
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) await tree(name);
    else if (entry.isFile()) await add(name);
    else throw Error("Ordinary selected static files required");
  }
}
for (const path of [
  "latest-scene",
  "latest-effects",
  "latest-effect-contexts",
  "latest-effect-resolvers",
  "latest-viewer-poses",
  "latest-animation-poses",
  "latest-world-state",
])
  await tree(path);
for (const path of [
  proofPath,
  resolverProofPath,
  submeshProofPath,
  ...fixedProgramPaths,
  ...SELECTED_BUILD_PROGRAMS.map(([path]) => path),
  worldStateReferencePath,
  "vendor/three.core.js",
  "decoder-16.21-macos/image.bin",
  "decoder-16.21-macos/animation-clock.json",
  "decoder-16.21-macos/animation-rigs.json",
  "decoder-16.21-macos/animation-events.json",
  "latest-world-descriptor-abi/package.json",
  "latest-builtin-resource-contexts/package.json",
  "latest-corpse/package.json",
  "latest-submesh-visibility/package.json",
  "latest-effect-placement/package.json",
  "latest-effect-descriptor/package.json",
  "latest-effect-creation/package.json",
])
  await add(path);
const roles = {
  scene: "latest-scene/manifest.json",
  effects: "latest-effects/manifest.json",
  effectContexts: "latest-effect-contexts/package.json",
  effectContextsProof: proofPath,
  effectResolvers: "latest-effect-resolvers/package.json",
  effectResolversProof: resolverProofPath,
  effectResolversReference:
    "latest-static-catalog/effect-resolvers-reference.json",
  effectsSource: "latest-effects/package.json",
  builtinResourceContexts: "latest-builtin-resource-contexts/package.json",
  unitResources: "latest-unit-resources/package.json",
  initialResourcePrefix: "latest-initial-resource-prefix/package.json",
  negativeFormPrefix: "latest-negative-form-prefix/package.json",
  corpsePolicy: "latest-corpse/package.json",
  corpsePolicyReference: "latest-static-catalog/corpse-policy-reference.json",
  submeshVisibility: "latest-submesh-visibility/package.json",
  submeshVisibilityReference:
    "latest-static-catalog/submesh-visibility-reference.json",
  submeshVisibilityProof: submeshProofPath,
  effectPlacement: "latest-effect-placement/package.json",
  effectPlacementReference:
    "latest-static-catalog/effect-placement-reference.json",
  effectDescriptor: "latest-effect-descriptor/package.json",
  effectDescriptorReference:
    "latest-static-catalog/effect-descriptor-reference.json",
  viewerPoses: "latest-viewer-poses/package.json",
  worldState: "latest-world-state/package.json",
  worldStateReference: worldStateReferencePath,
};
// This closure is emitted by the actual material producer/compiler capture.
// It selects data, while each consumer retains its independent native approval.
const materialFilesPath = "latest-selected-materials/files.json",
  materialFiles = decode(await load(materialFilesPath)),
  materialPackage = decode(
    await load("latest-selected-materials/package.json"),
  );
if (
  materialFiles.schema !== 1 ||
  materialFiles.mode !== materialPackage.mode ||
  !materialFiles.files
)
  throw Error("Source-owned selected material closure required");
await add(materialFilesPath);
for (const [path, ref] of Object.entries(materialFiles.files)) {
  await add(path);
  if (files[path].sha256 !== ref.sha256 || files[path].bytes !== ref.bytes)
    throw Error("Selected material closure input changed: " + path);
}
Object.assign(roles, {
  selectedMaterials: "latest-selected-materials/package.json",
  quadGpu: "latest-complete-quad-gpu/package.json",
});
if (materialPackage.mode === "native-quad-partial") {
  Object.assign(roles, {
    nativeQuadMaterials: "latest-selected-materials/native-materials.json",
    nativeMaterialReference:
      "latest-selected-materials/native-material-reference.json",
    boundQuads: "decoder-16.21-macos/vfx-bound-quads.json",
    shaderPackage: "latest-shaders/package.json",
    shaderPairs: "latest-selected-materials/shader-pairs.json",
    particleColor: "latest-particle-color/package.json",
    particleColorReference:
      "latest-selected-materials/particle-color-reference.json",
    selectedMaterialTextures: "latest-selected-material-textures/package.json",
  });
  const texturePackage = decode(await load(roles.selectedMaterialTextures));
  await add(roles.selectedMaterialTextures);
  for (const [file, ref] of Object.entries(texturePackage.files)) {
    const path = "latest-selected-material-textures/" + file;
    await add(path);
    if (files[path].sha256 !== ref.sha256 || files[path].bytes !== ref.bytes)
      throw Error("Selected material texture closure changed: " + path);
  }
} else if (materialPackage.mode === "fixed-original-complete") {
  Object.assign(roles, {
    trailGpu: "latest-trail-particles/gpu.json",
    erosionGpu: "latest-quad-erosion-gpu/package.json",
    navCameraMaterials: "latest-direct-nav-camera-materials/package.json",
  });
  const navCameraBytes = await load(roles.navCameraMaterials);
  if ((await sha256(navCameraBytes)) !== DIRECT_NAV_CAMERA_PACKAGE_SHA)
    throw Error("Fixed original camera-navigation material package required");
  const navCamera = decode(navCameraBytes);
  if (
    navCamera.kind !== "prepared-complete-native-navigation-camera-materials" ||
    navCamera.build !== profile.clientVersion ||
    navCamera.protocol !== profile.protocolDigest ||
    navCamera.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Exact-build camera-navigation material closure required");
  for (const emitter of navCamera.emitters) {
    const resources = [
      emitter.shaders.vertex,
      emitter.shaders.pixel,
      ...emitter.textures.flatMap((texture) => texture.levels.flat()),
    ];
    for (const ref of resources) {
      if (
        !/^(shaders\/[a-f0-9]{64}\.json|planes\/[a-f0-9]{64}\.bin)$/.test(
          ref.file,
        )
      )
        throw Error("Declared camera-navigation shader/plane required");
      const path = `latest-direct-nav-camera-materials/${ref.file}`;
      await add(path);
      if (files[path].sha256 !== ref.sha256 || files[path].bytes !== ref.bytes)
        throw Error("Declared camera-navigation resource differs: " + path);
    }
  }
  // Renderer catalogs are separate from the compiler's capture. Read their
  // declared leaves, not historical emulated frame-cache directories.
  for (const directory of [
    "latest-parent-textures",
    "latest-effect-root-textures",
    "latest-component-textures",
  ]) {
    const path = `${directory}/package.json`,
      catalog = decode(await load(path));
    await add(path);
    for (const ref of Object.values(catalog.textures))
      await add(`${directory}/${ref.file}`);
  }
} else throw Error("Explicit selected material mode required");
for (const path of Object.values(roles)) if (!files[path]) await add(path);
// Ordinary decoder/viewer entry metadata are individual files; their graph
// leaves come from the producer inventories above and the pose packages.
for (const entry of await readdir(`${cache}/public/decoder-16.21-macos`, {
  withFileTypes: true,
})) {
  if (entry.isSymbolicLink())
    throw Error("Selected decoder cannot follow links");
  if (entry.isFile() && entry.name !== "profile.json")
    await add(`decoder-16.21-macos/${entry.name}`);
}
const catalog = {
    schema: 1,
    kind: "prepared-selected-static-content",
    policy: STATIC_CATALOG_POLICY,
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    decoderImageSha256: profile.decoderImageSha256,
    map: { id: scene.map.id, presentationVariant: scene.map.variant },
    roles,
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  },
  catalogBytes = new TextEncoder().encode(JSON.stringify(catalog, null, 2)),
  catalogPath = "latest-static-catalog/catalog.json";
await Bun.write(`${cache}/public/${catalogPath}`, catalogBytes);
const bootstrap = {
  schema: 1,
  kind: "trusted-static-content-bootstrap",
  profile: {
    path: "decoder-16.21-macos/profile.json",
    sha256: await sha256(profileBytes),
  },
  catalog: { path: catalogPath, sha256: await sha256(catalogBytes) },
};
await Bun.write(
  `${cache}/public/latest-static-catalog/bootstrap.json`,
  JSON.stringify(bootstrap, null, 2),
);
const selected = await loadLatestStaticCatalogSelection({ load });
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await selected.readRole("effectContexts"),
  effectsManifestBytes: await selected.readRole("effects"),
  staticCatalog: selected,
});
if (
  (await sha256(await load("decoder-16.21-macos/profile.json"))) !==
  bootstrap.profile.sha256
)
  throw Error("Catalog preparation mutated the immutable profile");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Selected preparation source changed: " + path);
await Bun.write(
  `${cache}/research/selected-static-catalog-preparation.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "verified-selected-static-catalog-preparation",
      inputs,
      inventory: selected.describe(),
      contexts: contexts.metadata.contexts.length,
      scope: {
        profileUnchanged: true,
        selectedContextNativeObservationValidated: true,
        nativeMaterialAdmissionEstablished: false,
        runtimeCoverageEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    files: Object.keys(files).length,
    roles: Object.keys(roles),
    contexts: contexts.metadata.contexts.length,
    catalogSha256: bootstrap.catalog.sha256,
  }),
);

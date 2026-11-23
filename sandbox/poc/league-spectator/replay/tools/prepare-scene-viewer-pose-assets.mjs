// Scene-specific static model identities, independently bound to the unchanged
// approved native profile and scene animation authority. No replay is read.
import path from "node:path";
import { realpath } from "node:fs/promises";
import {
  assertSceneAnimationAuthorityIdentity,
  sceneAnimationFilePath,
} from "../scene-animation-authority.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  readOriginalRigOrdinalSource,
  validateOrdinalModelLayout,
} from "../ordinal-model-bindings.mjs";

const [approvedArg, sceneArg, authorityArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 6)
  throw Error(
    "Usage: bun prepare-scene-viewer-pose-assets.mjs <approved-source-cache> <scene-root> <animation-authority.json> <output-cache>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  inputs = new Map(),
  approved = await realpath(approvedArg),
  sceneRoot = await realpath(sceneArg),
  imageSha256 =
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  mathSha256 =
    "3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759";
async function raw(file) {
  const canonical = await realpath(file),
    bytes = await Bun.file(canonical).bytes(),
    digest = sha(bytes);
  const prior = inputs.get(canonical);
  if (prior && prior.sha256 !== digest)
    throw Error(`Input changed during model preparation: ${canonical}`);
  inputs.set(canonical, { sha256: digest, bytes: bytes.length });
  return bytes;
}
const profileBytes = await raw(
    path.join(approved, "public/decoder-16.21-macos/profile.json"),
  ),
  profile = decode(profileBytes),
  image = await raw(
    path.join(approved, "public/decoder-16.21-macos/image.bin"),
  ),
  sceneBytes = await raw(path.join(sceneRoot, "manifest.json")),
  scene = decode(sceneBytes),
  authorityBytes = await raw(authorityArg),
  authority = assertSceneAnimationAuthorityIdentity(decode(authorityBytes), {
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    baseProfileSha256: sha(profileBytes),
    imageSha256: sha(image),
    sceneManifestSha256: sha(sceneBytes),
  });
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  profile.decoderImageSha256 !== imageSha256 ||
  profile.decoderImageSha256 !== sha(image) ||
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest ||
  scene.map?.id !== 11 ||
  !Array.isArray(scene.files) ||
  !scene.champions ||
  !Object.keys(scene.champions).length
)
  throw Error("Exact prepared Map11 scene and unchanged native build required");
const math = await raw(path.join(approved, "public/vendor/three.core.js"));
if (sha(math) !== mathSha256) throw Error("Pinned viewer pose math changed");
const files = new Map();
for (const file of scene.files) {
  sceneAnimationFilePath(file.path);
  if (
    files.has(file.path) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes <= 0
  )
    throw Error("Unique closed scene model inventory required");
  files.set(file.path, file);
}
async function sceneFile(relative) {
  sceneAnimationFilePath(relative);
  const expected = files.get(relative);
  if (!expected)
    throw Error(`Model input is outside closed scene inventory: ${relative}`);
  const file = await realpath(path.join(sceneRoot, relative));
  const relation = path.relative(sceneRoot, file);
  if (
    !relation ||
    path.isAbsolute(relation) ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`)
  )
    throw Error("Canonical scene model input escaped its source root");
  const bytes = await raw(file);
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error(`Closed scene model input changed: ${relative}`);
  return bytes;
}
const models = {};
for (const [key, asset] of Object.entries(scene.champions)) {
  if (!Number.isFinite(asset.scale) || asset.scale <= 0)
    throw Error("Prepared original actor scale required");
  const identity = authority.roles.leafPoses.identities.find(
    (entry) => entry.actor === `champions/${key}`,
  );
  if (
    !identity ||
    identity.graph !== asset.animationGraph ||
    identity.catalog !== asset.animationCatalog
  )
    throw Error(
      `Champion model lacks its exact scene animation authority: ${key}`,
    );
  const bytes = await sceneFile(asset.model),
    graphBytes = await sceneFile(asset.animationGraph),
    catalogBytes = await sceneFile(asset.animationCatalog),
    rigBytes = await sceneFile(identity.rig);
  if (
    sha(graphBytes) !== identity.graphSha256 ||
    sha(catalogBytes) !== identity.catalogSha256 ||
    sha(rigBytes) !== identity.rigSha256
  )
    throw Error(
      `Animation authority dependencies differ from actual model sources: ${key}`,
    );
  if (bytes.length < 20) throw Error("Truncated prepared GLB2 model");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    view.getUint32(12, true) > bytes.length - 20
  )
    throw Error("Exact prepared GLB2 actor model required");
  if (typeof asset.rigJointBindings !== "string")
    throw Error("New scene models require original ordinal joint bindings");
  const bindingBytes = await sceneFile(asset.rigJointBindings),
    bindings = decode(bindingBytes),
    meshBytes = await sceneFile(asset.model.replace(/\.glb$/, ".skn"));
  if (
    bindings.modelSha256 !== sha(bytes) ||
    bindings.rigSha256 !== sha(rigBytes) ||
    bindings.meshSha256 !== sha(meshBytes)
  )
    throw Error("Original ordinal model source identities differ");
  validateOrdinalModelLayout({
    bindings,
    gltf: decode(bytes.subarray(20, 20 + view.getUint32(12, true))),
    ...readOriginalRigOrdinalSource(rigBytes),
  });
  const modelPath = `latest-scene/${asset.model}`;
  if (Object.hasOwn(models, modelPath))
    throw Error("Champion model identities collide");
  models[modelPath] = {
    sha256: sha(bytes),
    graph: asset.animationGraph,
    catalog: asset.animationCatalog,
    scale: asset.scale,
    rigJointBindings: asset.rigJointBindings,
    rigJointBindingsSha256: sha(bindingBytes),
  };
}
await raw(import.meta.path);
await raw(new URL("../scene-animation-authority.mjs", import.meta.url));
await raw(new URL("./map-scene-output.mjs", import.meta.url));
await raw(new URL("../ordinal-model-bindings.mjs", import.meta.url));
await raw(new URL("./ordinal-model-layout.mjs", import.meta.url));
for (const [file, expected] of inputs)
  if (sha(await Bun.file(file).bytes()) !== expected.sha256)
    throw Error(`Model producer input drift: ${file}`);
const { out, work } = await createStaticPreparationOutput(approved, outputArg, {
  prefix: "viewer-poses-",
  directory: "latest-viewer-poses",
});
const scope = {
  staticBuildAssetsOnly: true,
  replayEntityIds: false,
  replayEvents: false,
  nativePoseParity: false,
  engineWorldAcceptance: false,
};
const bytes = new TextEncoder().encode(
  JSON.stringify(
    {
      schema: 1,
      kind: "pinned-static-viewer-pose-assets",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      decoderImageSha256: profile.decoderImageSha256,
      baseProfileSha256: sha(profileBytes),
      sceneManifestSha256: sha(sceneBytes),
      sceneAnimationAuthoritySha256: sha(authorityBytes),
      mathSha256,
      models,
      scope,
    },
    null,
    2,
  ),
);
const packageSha256 = sha(bytes);
await Bun.write(
  path.join(work, "proof.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "scene-viewer-model-identity-proof",
      packageSha256,
      inputs: Object.fromEntries(inputs),
      models: Object.keys(models).length,
      scope,
    },
    null,
    2,
  ),
);
await Bun.write(path.join(out, "package.json"), bytes);
console.log(
  JSON.stringify({
    output: out,
    packageSha256,
    models: Object.keys(models).length,
    inputs: inputs.size,
    spectatorAdmission: false,
  }),
);

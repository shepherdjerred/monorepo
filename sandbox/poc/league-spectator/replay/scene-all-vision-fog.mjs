// A scoped original replay-camera action, not a substitute for team fog. The
// caller must select the supported all-vision perspective explicitly.
import { sha256 } from "./structural-comparison.mjs";
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
import { canonicalOriginalDefaultPixel } from "./scene-cold-default-textures.mjs";
const IMAGE =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const PROFILE =
  "d970900e97da41fc81eab2c81e80082a5b0e14169ba6227af7f5b394878c2d72";
const RECIPES = {
  "probe-original-fow-material-resources.py":
    "a73c8482a4808b26003382e222d19c488cddb7760b55c3e61d707e7f51552f21",
  "observe-native-shader-global-fields.py":
    "58209775fa6b1bd6656361e79a88831c3edee33fbbe46ff9b4efaa427bd75ffd",
  "shader_global_registry_native.py":
    "4f669cb410cd2c872b593c9dd6dfb4c0d667903839783900a57ff9e6088b9c87",
  "original_sampler_gpu.py":
    "4b7af38c5940c447b2dd3f0324a3699ec05c13bdbe7c9e4742f366cba9a56482",
};
const owned = new WeakSet(),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const need = (value, message) => {
  if (!value) throw Error(message);
};
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isSceneAllVisionFog = (value) => owned.has(value);

export async function describeOriginalAllVisionFogProofs(
  resourceBytes,
  extentBytes,
) {
  const resource = decode(resourceBytes),
    extent = decode(extentBytes),
    e = resource.fowResourceExtension;
  for (const proof of [resource, extent])
    need(
      proof.schema === 1 &&
        proof.build === "16.21.829.8620" &&
        proof.protocol === "20e09df23c66b85e" &&
        proof.decoderImageSha256 === IMAGE &&
        (proof.boundary ?? null) === null,
      "Exact original all-vision native proof required",
    );
  need(
    resource.kind === "original-shared-shader-field-reader-observations" &&
      extent.kind === "original-map11-fow-extent-uniform-control",
    "Original all-vision proof kinds differ",
  );
  for (const [file, digest] of Object.entries(RECIPES))
    need(
      resource.sources?.[file] === digest,
      "Original all-vision recipe differs: " + file,
    );
  const extentRecipes = Object.entries(extent.inputs ?? {}).filter(([file]) =>
    /[\\/]probe-original-map11-fow-extent\.py$/.test(file),
  );
  need(
    extentRecipes.length === 1 &&
      extentRecipes[0][1] ===
        "45654a833451fa617252fb471a08a8a6f1806c926de420fbb43b5315a76a9d8f",
    "Original typed Map11 extent recipe differs",
  );
  need(
    e?.completeOriginalSharedControlReturned === true &&
      e.sourceOwnerPathHash === "85390927" &&
      e.sourceTextureIndex === 8 &&
      e.extentProofSha256 === (await sha256(extentBytes)) &&
      e.controllerReads?.length === 0 &&
      e.unregisteredNameResult === 0,
    "Original all-vision source selection or negative controls differ",
  );
  need(
    same(e.scope, {
      explicitAllVisionNativeCallbackExecuted: true,
      originalNamedSourceViewAndGlobalAcquisition: true,
      originalTextureSelectorGetterSetterAndReleaseExecuted: true,
      sceneControllerNotRead: true,
      nativeWhiteTextureSynthesized: false,
      actualMap11UniformSource: true,
      shaderFogModeChanged: false,
      fullGuiRefreshExecuted: false,
      teamPerspectiveAdmitted: false,
      gpuDrawSubmitted: false,
      nativeSpectatorAdmitted: false,
    }),
    "All-vision execution scope differs",
  );
  need(
    extent.scope?.originalTypedBoundFieldsAndConstructorDefaults === true &&
      extent.scope.originalProviderConstructionAndBoundCopy === true &&
      extent.scope.bothPublishedExtentAxesComparedAsRawBytes === true &&
      extent.scope.actualMap11ExtentRecovered === true &&
      extent.scope.originalUniformLeafExecuted === true &&
      extent.scope.componentLoopExecuted === false &&
      extent.scope.completeMapBootstrapExecuted === false &&
      extent.scope.dynamicTeamFogProduced === false,
    "Original Map11 bound/uniform scope differs",
  );
  need(
    extent.loaded?.typeHash === 0xdde8c114 &&
      extent.loaded.fields === 1 &&
      extent.loaded.originalSkippedFields?.length === 0 &&
      extent.loaded.pendingReferences?.length === 0,
    "Original MapContainer reader is incomplete",
  );
  const properties = extent.classDescriptor?.properties;
  for (const [hash, offset] of [
    [0xb14297a4, 32],
    [0xbf563566, 40],
  ])
    need(
      properties?.filter(
        (p) => p.hash === hash && p.offset === offset && p.type === 11,
      ).length === 1,
      "Original MapContainer bound field differs",
    );
  need(
    extent.providerBoundsHex === "00000000000000001a926746fd856846" &&
      extent.publishedExtentHex === "1a92674600000000fd856846" &&
      extent.uniformHex === "d3808d38d3808db8000000000000803f" &&
      e.uniformHex === extent.uniformHex &&
      hex(extent.sourceBinSha256),
    "Original Map11 bounds or uniform raw bytes differ",
  );
  const pixel = await canonicalOriginalDefaultPixel(e.selectedResource),
    sampler = e.samplerProof;
  const samplerHex = "01010100000000000100010100000000",
    gpu = {
      10240: 9729,
      10241: 9729,
      10242: 33071,
      10243: 33071,
      32882: 33071,
    };
  need(
    pixel.nativeSourceSha256 ===
      "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e" &&
      same(e.samplerArguments, {
        descriptorHex: samplerHex,
        originalCompareModeArgument: 1,
      }) &&
      same(sampler?.nativeArguments, e.samplerArguments) &&
      same(sampler.gpu?.parameters, gpu) &&
      same(sampler.gpu.queriedParameters, gpu) &&
      same(sampler.comparedGpuParameters, gpu),
    "Original all-vision GPU resource or sampler differs",
  );
  return {
    perspective: "all",
    sourceMaterialsSha256: extent.sourceBinSha256,
    uniformHex: extent.uniformHex,
    resource: {
      ...pixel,
      sampler: { name: "clamp", pixelated: false },
      nativeSamplerHex: samplerHex,
    },
    scope: structuredClone(e.scope),
  };
}

export async function createSceneAllVisionFog({
  manifestBytes,
  readResource,
  sceneBytes,
  worldBytes,
  baseProfileBytes,
  imageBytes,
  perspective,
}) {
  need(
    perspective === "all",
    "Explicit supported all-vision perspective required",
  );
  const manifest = decode(manifestBytes),
    scene = decode(sceneBytes),
    world = decode(worldBytes);
  need(
    manifest.schema === 1 &&
      manifest.kind === "original-scene-all-vision-fog" &&
      manifest.perspective === "all" &&
      manifest.build === "16.21.829.8620" &&
      manifest.protocol === "20e09df23c66b85e" &&
      scene.build === manifest.build &&
      scene.protocol === manifest.protocol &&
      world.build === manifest.build &&
      world.protocol === manifest.protocol &&
      world.mapId === 11 &&
      manifest.decoderImageSha256 === IMAGE &&
      (await sha256(imageBytes)) === IMAGE &&
      (await sha256(baseProfileBytes)) === PROFILE &&
      manifest.baseProfileSha256 === PROFILE &&
      manifest.sceneManifestSha256 === (await sha256(sceneBytes)) &&
      manifest.worldSha256 === (await sha256(worldBytes)),
    "All-vision authority scene/build parent differs",
  );
  need(
    Array.isArray(manifest.files) && manifest.files.length === 2,
    "Closed all-vision proof inventory required",
  );
  const proofs = [];
  for (const file of ["resource-proof.json", "extent-proof.json"]) {
    const rows = manifest.files.filter((row) => row.file === file);
    need(
      rows.length === 1 &&
        Number.isSafeInteger(rows[0].bytes) &&
        rows[0].bytes > 0 &&
        rows[0].bytes <= 8 * 1024 ** 2 &&
        hex(rows[0].sha256),
      "Bounded all-vision proof identity required",
    );
    const bytes = await readResource(file);
    need(
      bytes instanceof Uint8Array &&
        bytes.length === rows[0].bytes &&
        (await sha256(bytes)) === rows[0].sha256,
      "All-vision proof bytes differ",
    );
    proofs.push(bytes);
  }
  const evidence = await describeOriginalAllVisionFogProofs(...proofs),
    extent = decode(proofs[1]);
  need(
    world.sourceMaterialsSha256 === evidence.sourceMaterialsSha256 &&
      same(manifest.evidence, evidence),
    "All-vision source map or evidence projection differs",
  );
  for (const block of extent.sourceBlocks)
    need(
      Number.isSafeInteger(block.rva) &&
        Number.isSafeInteger(block.bytes) &&
        block.bytes > 0 &&
        block.rva >= 0 &&
        block.rva + block.bytes <= imageBytes.length &&
        (await sha256(
          imageBytes.subarray(block.rva, block.rva + block.bytes),
        )) === block.sha256,
      "Original FoW extent program differs",
    );
  const authoritySha256 = await sha256(manifestBytes),
    api = Object.freeze({
      describe: () => structuredClone({ ...evidence, authoritySha256 }),
      uniform: () => ({
        name: "FOG_OF_WAR_PARAMS",
        bytesHex: evidence.uniformHex,
      }),
      binding: () => ({
        kind: "original-all-vision-fog-texture",
        perspective: "all",
        authoritySha256,
        ...structuredClone(evidence.resource),
      }),
    });
  owned.add(api);
  return api;
}

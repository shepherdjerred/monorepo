import { sha256 } from "./structural-comparison.mjs";
const IMAGE =
  "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7";
const RECIPES = {
  "observe-original-particle-default-textures.py":
    "9410486a9eb5e413585609e1738d2f141eee9b4d641c286fc587961f0cfe8629",
  "observe-native-shader-global-fields.py":
    "58209775fa6b1bd6656361e79a88831c3edee33fbbe46ff9b4efaa427bd75ffd",
  "shader_global_registry_native.py":
    "4f669cb410cd2c872b593c9dd6dfb4c0d667903839783900a57ff9e6088b9c87",
  "native_float4_texture_upload.py":
    "7fc37a47ddfaaa801f88c9c906277a17ef5d41fc04109883ca1c440e29109803",
  "graphics_float4_texture_device.py":
    "b065a182509247266edee4b38949efd34206b94367d9cab167fba264b513a04e",
  "original_sampler_gpu.py":
    "4b7af38c5940c447b2dd3f0324a3699ec05c13bdbe7c9e4742f366cba9a56482",
};
const COLOR_SLOT_RECIPE =
  "a98954b1d8ccc4dc34dd335312f7ad29f9e77d737bca55a87410bfab3c1a54be";
const need = (value, message) => {
    if (!value) throw Error(message);
  },
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export async function canonicalOriginalDefaultPixel(resource) {
  need(
    resource?.gpuBytesVerified === true &&
      resource.kind === "2d" &&
      resource.nativeFormat === 2 &&
      resource.nativeType === 0 &&
      resource.width === 1 &&
      resource.height === 1 &&
      resource.layers === 1 &&
      resource.mips === 1 &&
      resource.flags === 0 &&
      resource.levelsHex?.length === 1 &&
      resource.levelsHex[0].length === 1 &&
      /^[a-f0-9]{8}$/.test(resource.levelsHex[0][0]),
    "Exact original one-pixel BGRA8 default required",
  );
  const bgra = Uint8Array.from(resource.levelsHex[0][0].match(/../g), (value) =>
      parseInt(value, 16),
    ),
    rgba = Uint8Array.of(bgra[2], bgra[1], bgra[0], bgra[3]);
  need(
    resource.nativeSourceSha256 === (await sha256(bgra)) &&
      resource.readbacks?.length === 1 &&
      resource.readbacks[0].mip === 0 &&
      resource.readbacks[0].layer === 0 &&
      resource.readbacks[0].bytes === 4 &&
      resource.readbacks[0].sha256 === (await sha256(rgba)),
    "Original default GPU byte readback differs",
  );
  return {
    rgba: [...rgba],
    width: 1,
    height: 1,
    nativeFormat: 2,
    nativeSourceSha256: resource.nativeSourceSha256,
    rgbaSha256: await sha256(rgba),
  };
}
export async function describeOriginalColdDefaultProofs(slotBytes, remapBytes) {
  const slots = decode(slotBytes),
    remap = decode(remapBytes);
  for (const proof of [slots, remap])
    need(
      proof.schema === 1 &&
        proof.build === "16.21.829.8620" &&
        proof.protocol === "20e09df23c66b85e" &&
        proof.decoderImageSha256 === IMAGE &&
        proof.boundary === null,
      "Exact original cold-default native proof required",
    );
  need(
    slots.kind === "original-particle-default-texture-controls" &&
      slots.scope.originalSlotFallbackExecuted === true &&
      slots.scope.verifiedGpuResources === true &&
      slots.scope.actualEmitterNameLookup === false &&
      slots.scope.liveScenePredicates === false &&
      slots.controls.length === 11,
    "Complete original null/empty slot controls required",
  );
  need(
    remap.kind === "original-shared-shader-field-reader-observations" &&
      remap.localReferenceFixups?.links === 54 &&
      remap.localReferenceFixups.remainingQueue === 0 &&
      remap.localReferenceFixups.rejectedNonNullReferences.length === 0,
    "Original Shared typed resource closure required",
  );
  for (const [file, digest] of Object.entries(RECIPES))
    need(
      (file === "observe-original-particle-default-textures.py" ? slots : remap)
        .sources[file] ===
        (file === "observe-original-particle-default-textures.py" &&
        slots.emptyParticleColorRoute
          ? COLOR_SLOT_RECIPE
          : digest),
      "Original cold-default native recipe differs: " + file,
    );
  const resources = {};
  for (const [key, slot, field] of [
    ["absent-base", 0, 0xa8],
    ["absent-mult", 7, 0xa0],
  ]) {
    const variants = [];
    for (const nameControl of [
      "null-identity-control",
      "original-interned-empty-name",
    ]) {
      const rows = slots.controls.filter(
        (row) => row.suppliedSlot === slot && row.nameControl === nameControl,
      );
      need(
        rows.length === 1 &&
          rows[0].managerFieldOffset === field &&
          rows[0].header === rows[0].resource.pointer,
        "Original absent-slot resource identity differs",
      );
      variants.push(await canonicalOriginalDefaultPixel(rows[0].resource));
    }
    need(
      JSON.stringify(variants[0]) === JSON.stringify(variants[1]),
      "Original null and empty slot defaults differ",
    );
    resources[key] = {
      ...variants[0],
      originalSlot: slot,
      originalManagerField: field,
    };
  }
  const shared = remap.sharedTextureRowRegistration;
  need(
    shared?.name === "PIXEL_COLOR_REMAP_RAMP" &&
      shared.originalOwnerPathHash === "85390927" &&
      shared.header === shared.resource.pointer &&
      shared.scope.oneOriginalSourceRowRegistered === true &&
      shared.scope.coldRemapInitializationExecuted === true &&
      shared.scope.dynamicRemapRecovered === false &&
      shared.scope.actualScenePredicates === false &&
      shared.scope.nativeRendererAdmitted === false &&
      shared.originalRemapCaller?.join(":") === [0x7456bd, 0x74571d].join(":"),
    "Original cold Shared remap initialization required",
  );
  const kinds = new Set(shared.negativeControls?.map((row) => row.kind));
  need(
    kinds.size === 3 &&
      [
        "unregistered-original-name",
        "unsupported-border-address",
        "unsupported-comparison-mode",
      ].every((kind) => kinds.has(kind)),
    "Native default-resource negative controls required",
  );
  const remapPixel = await canonicalOriginalDefaultPixel(shared.resource);
  need(
    remapPixel.rgbaSha256 === resources["absent-base"].rgbaSha256,
    "Cold Shared remap did not retain original manager A8 bytes",
  );
  const samplers = Object.values(remap.partialGlesSamplerResources ?? {});
  need(
    samplers.length === 1 &&
      samplers[0].nativeArguments.descriptorHex ===
        "01010100000000000100010100000000" &&
      JSON.stringify(samplers[0].gpu.parameters) ===
        JSON.stringify(samplers[0].gpu.queriedParameters) &&
      JSON.stringify(samplers[0].gpu.parameters) ===
        JSON.stringify(samplers[0].comparedGpuParameters),
    "Original Shared sampler GPU readback differs",
  );
  resources["shared-remap"] = {
    ...remapPixel,
    originalName: shared.name,
    nativeSamplerHex: samplers[0].nativeArguments.descriptorHex,
    sampler: { name: "clamp", pixelated: false },
  };
  if (slots.emptyParticleColorRoute) {
    const color = slots.emptyParticleColorRoute;
    need(
      color.semantic === "PARTICLE_COLOR_TEXTURE" &&
        color.nativeSlot === 1 &&
        color.authoredPathControl === "" &&
        color.originalCallerPrefix?.join(":") ===
          [0x16dec64, 0x16dec8d].join(":") &&
        color.originalSamplerPrefix?.join(":") ===
          [0x16e3910, 0x16e3a53].join(":") &&
        color.originalNameTableRva === 0x23ef550 &&
        color.managerFieldOffset === 0xa0 &&
        color.header === color.resource.pointer &&
        color.scope.originalEmptyNameCallerExecuted === true &&
        color.scope.namedResourceAcquisition === false &&
        color.scope.liveScenePredicates === false &&
        color.scope.nativeRendererAdmitted === false &&
        color.samplerControls.length === 8,
      "Original empty color semantic route required",
    );
    for (const pixelated of [false, true])
      for (let address = 0; address < 4; address++) {
        const rows = color.samplerControls.filter(
          (row) =>
            row.pixelated === pixelated && row.authoredAddress === address,
        );
        need(
          rows.length === 1 &&
            rows[0].descriptorHex === (pixelated ? "0101010000" : "0101010101"),
          "Original color semantic sampler controls differ",
        );
      }
    const pixel = await canonicalOriginalDefaultPixel(color.resource);
    need(
      pixel.rgbaSha256 === resources["absent-mult"].rgbaSha256,
      "Original empty color semantic did not select manager A0 bytes",
    );
    resources["absent-color"] = {
      ...pixel,
      originalSlot: 1,
      originalManagerField: 0xa0,
      originalName: "PARTICLE_COLOR_TEXTURE",
    };
  }
  return {
    resources,
    capability: "original-cold-defaults-only",
    actualEmitterColorDefaultProved: false,
    actualScenePredicates: false,
    dynamicRemapRecovered: false,
    nativeRendererAdmitted: false,
    ...(slots.emptyParticleColorRoute
      ? { emptyAuthoredColorBindingProved: true }
      : {}),
  };
}
export async function createSceneColdDefaultTextures({
  manifestBytes,
  readResource,
}) {
  const manifest = decode(manifestBytes);
  need(
    [1, 2].includes(manifest.schema) &&
      manifest.kind === "original-cold-material-default-textures" &&
      manifest.build === "16.21.829.8620" &&
      manifest.protocol === "20e09df23c66b85e" &&
      manifest.decoderImageSha256 === IMAGE &&
      manifest.files?.length === 2,
    "Original cold-default package authority required",
  );
  const proofBytes = [];
  for (const file of ["slot-proof.json", "remap-proof.json"]) {
    const rows = manifest.files.filter((row) => row.file === file);
    need(
      rows.length === 1 &&
        Number.isSafeInteger(rows[0].bytes) &&
        rows[0].bytes > 0 &&
        rows[0].bytes <= 8 * 1024 ** 2,
      "Bounded exact native default proof resource required",
    );
    const bytes = await readResource(file);
    need(
      bytes instanceof Uint8Array &&
        bytes.length === rows[0].bytes &&
        (await sha256(bytes)) === rows[0].sha256,
      "Original cold-default proof bytes differ",
    );
    proofBytes.push(bytes);
  }
  const result = await describeOriginalColdDefaultProofs(...proofBytes);
  need(
    manifest.schema === (result.emptyAuthoredColorBindingProved ? 2 : 1),
    "Native cold-default authority schema differs from its capabilities",
  );
  need(
    JSON.stringify(manifest.evidence) === JSON.stringify(result),
    "Cold-default resource projection differs from native proof",
  );
  const authoritySha256 = await sha256(manifestBytes);
  return Object.freeze({
    describe: () => structuredClone({ ...result, authoritySha256 }),
    binding({ semantic, authoredPath, samplerDescriptorHex }) {
      need(
        Object.hasOwn(result.resources, semantic),
        "Unproved original default texture semantic",
      );
      const resource = result.resources[semantic];
      let sampler = resource.sampler,
        nativeSamplerHex = resource.nativeSamplerHex;
      if (semantic !== "shared-remap") {
        need(
          authoredPath === null ||
            authoredPath === undefined ||
            authoredPath === "",
          "Named authored textures cannot use absent-resource defaults",
        );
        need(
          /^(0[0-2]){3}(0[0-1]){2}$/.test(samplerDescriptorHex ?? ""),
          "Original absent-resource sampler descriptor required",
        );
        const values = samplerDescriptorHex
          .match(/../g)
          .map((value) => parseInt(value, 16));
        need(
          values.slice(0, 3).every((value) => value === values[0]) &&
            values[3] === values[4] &&
            (semantic !== "absent-color" || values[0] === 1),
          "Unsupported original absent-resource sampler",
        );
        sampler = {
          name: ["repeat", "clamp", "mirror"][values[0]],
          pixelated: !values[3],
        };
        nativeSamplerHex = samplerDescriptorHex;
      }
      return {
        kind: "original-cold-default-texture",
        semantic,
        authoritySha256,
        rgba: [...resource.rgba],
        rgbaSha256: resource.rgbaSha256,
        width: 1,
        height: 1,
        sampler: { ...sampler },
        nativeSamplerHex,
      };
    },
  });
}
